import path from 'node:path';
import type { NodePath, PluginObj, PluginPass, types as BabelTypes } from '@babel/core';

export interface CheckpointA11yPluginOptions {
  /** Paths in data-a11y-src are relative to this. Default: process.cwd(). */
  root?: string;
  /** Turn stamping off without removing the plugin. Default: true. */
  enabled?: boolean;
  /** Skip files matching any of these substrings. Default: ["node_modules"]. */
  exclude?: string[];
}

export const CMP_ATTR = 'data-a11y-cmp';
export const SRC_ATTR = 'data-a11y-src';

type T = typeof BabelTypes;
type FnNode = BabelTypes.FunctionDeclaration | BabelTypes.FunctionExpression | BabelTypes.ArrowFunctionExpression | BabelTypes.ClassMethod;

const isComponentName = (name: string | undefined | null): name is string => !!name && /^[A-Z]/.test(name);

/**
 * Stamps the outermost host (DOM) elements each component writes with
 *   data-a11y-cmp="ComponentName" and data-a11y-src="relative/path.tsx:line".
 *
 * "Outermost host elements" means: descend through fragments, conditionals, list maps and the children of
 * other components until the first lowercase JSX element. So in
 *   function Checkout() { return <Layout><form>...</form></Layout> }
 * the <form> is stamped as Checkout, not left to Layout. Elements nested inside a stamped element inherit
 * attribution through the DOM, which keeps the added markup small.
 *
 * Enable it only for the CI build: it adds attributes to production markup.
 */
export default function checkpointA11yBabelPlugin({ types: t }: { types: T }): PluginObj<PluginPass & { opts: CheckpointA11yPluginOptions }> {
  function relFile(state: PluginPass & { opts: CheckpointA11yPluginOptions }): string | undefined {
    const file = state.filename;
    if (!file) return undefined;
    const root = state.opts.root ?? process.cwd();
    return path.relative(root, file).split(path.sep).join('/');
  }

  function hasAttr(el: BabelTypes.JSXOpeningElement, name: string): boolean {
    return el.attributes.some((a) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === name);
  }

  function isHost(el: BabelTypes.JSXOpeningElement): boolean {
    return t.isJSXIdentifier(el.name) && /^[a-z]/.test(el.name.name);
  }

  function stampExpression(node: BabelTypes.Node | null | undefined, name: string, file: string, depth = 0): void {
    if (!node || depth > 40) return;
    if (t.isJSXElement(node)) {
      const open = node.openingElement;
      if (isHost(open)) {
        if (!hasAttr(open, CMP_ATTR)) {
          const line = open.loc?.start.line;
          open.attributes.push(
            t.jsxAttribute(t.jsxIdentifier(CMP_ATTR), t.stringLiteral(name)),
            t.jsxAttribute(t.jsxIdentifier(SRC_ATTR), t.stringLiteral(line ? `${file}:${line}` : file)),
          );
        }
        return;
      }
      for (const child of node.children) stampExpression(child, name, file, depth + 1);
      return;
    }
    if (t.isJSXFragment(node)) {
      for (const child of node.children) stampExpression(child, name, file, depth + 1);
      return;
    }
    if (t.isJSXExpressionContainer(node)) return stampExpression(node.expression as BabelTypes.Node, name, file, depth + 1);
    if (t.isConditionalExpression(node)) {
      stampExpression(node.consequent, name, file, depth + 1);
      stampExpression(node.alternate, name, file, depth + 1);
      return;
    }
    if (t.isLogicalExpression(node)) {
      stampExpression(node.left, name, file, depth + 1);
      stampExpression(node.right, name, file, depth + 1);
      return;
    }
    if (t.isParenthesizedExpression(node) || t.isTSAsExpression(node) || t.isTSNonNullExpression(node)) {
      return stampExpression(node.expression, name, file, depth + 1);
    }
    if (t.isCallExpression(node)) {
      // items.map((item) => <li/>) and similar render callbacks
      for (const arg of node.arguments) {
        if (t.isArrowFunctionExpression(arg) || t.isFunctionExpression(arg)) stampFunction(arg, name, file, depth + 1);
      }
    }
  }

  function stampFunction(fn: FnNode, name: string, file: string, depth = 0): void {
    if (t.isArrowFunctionExpression(fn) && !t.isBlockStatement(fn.body)) {
      stampExpression(fn.body, name, file, depth);
      return;
    }
    const body = fn.body as BabelTypes.BlockStatement;
    // Walk statements without entering nested functions, collecting return arguments.
    const visit = (stmt: BabelTypes.Node | null | undefined): void => {
      if (!stmt) return;
      if (t.isReturnStatement(stmt)) return stampExpression(stmt.argument, name, file, depth);
      if (t.isBlockStatement(stmt)) return stmt.body.forEach(visit);
      if (t.isIfStatement(stmt)) {
        visit(stmt.consequent);
        visit(stmt.alternate);
        return;
      }
      if (t.isSwitchStatement(stmt)) return stmt.cases.forEach((c) => c.consequent.forEach(visit));
      if (t.isTryStatement(stmt)) {
        visit(stmt.block);
        visit(stmt.handler?.body);
        visit(stmt.finalizer);
      }
    };
    visit(body);
  }

  /** memo(...), forwardRef(...), React.memo(React.forwardRef(...)), observer(...) */
  function unwrapComponentInit(node: BabelTypes.Node | null | undefined): FnNode | undefined {
    if (!node) return undefined;
    if (t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)) return node;
    if (t.isCallExpression(node)) {
      const first = node.arguments[0];
      if (first && !t.isSpreadElement(first) && !t.isArgumentPlaceholder(first)) return unwrapComponentInit(first);
    }
    if (t.isTSAsExpression(node) || t.isParenthesizedExpression(node)) return unwrapComponentInit(node.expression);
    return undefined;
  }

  function nameFromFile(file: string): string {
    const base = path.basename(file).replace(/\.[^.]+$/, '');
    const n = base === 'index' ? path.basename(path.dirname(file)) : base;
    return n.replace(/(^|[-_])(\w)/g, (_m, _s, c: string) => c.toUpperCase());
  }

  return {
    name: 'checkpoint-a11y',
    visitor: {
      Program(_p, state) {
        const s = state as PluginPass & { opts: CheckpointA11yPluginOptions; __skip?: boolean };
        const exclude = s.opts.exclude ?? ['node_modules'];
        s.__skip = s.opts.enabled === false || !s.filename || exclude.some((e) => s.filename!.includes(e));
      },
      FunctionDeclaration(p: NodePath<BabelTypes.FunctionDeclaration>, state) {
        if ((state as { __skip?: boolean }).__skip) return;
        const file = relFile(state);
        if (!file) return;
        let name = p.node.id?.name;
        if (!name && t.isExportDefaultDeclaration(p.parent)) name = nameFromFile(file);
        if (isComponentName(name)) stampFunction(p.node, name, file);
      },
      VariableDeclarator(p: NodePath<BabelTypes.VariableDeclarator>, state) {
        if ((state as { __skip?: boolean }).__skip) return;
        const file = relFile(state);
        if (!file || !t.isIdentifier(p.node.id) || !isComponentName(p.node.id.name)) return;
        const fn = unwrapComponentInit(p.node.init);
        if (fn) stampFunction(fn, p.node.id.name, file);
      },
      ExportDefaultDeclaration(p: NodePath<BabelTypes.ExportDefaultDeclaration>, state) {
        if ((state as { __skip?: boolean }).__skip) return;
        const file = relFile(state);
        if (!file) return;
        const fn = unwrapComponentInit(p.node.declaration as BabelTypes.Node);
        if (fn) stampFunction(fn, nameFromFile(file), file);
      },
      ClassMethod(p: NodePath<BabelTypes.ClassMethod>, state) {
        if ((state as { __skip?: boolean }).__skip) return;
        if (!t.isIdentifier(p.node.key) || p.node.key.name !== 'render') return;
        const cls = p.parentPath.parentPath?.node;
        const file = relFile(state);
        if (!file || !cls || !(t.isClassDeclaration(cls) || t.isClassExpression(cls))) return;
        const name = cls.id?.name ?? nameFromFile(file);
        if (isComponentName(name)) stampFunction(p.node, name, file);
      },
    },
  };
}
