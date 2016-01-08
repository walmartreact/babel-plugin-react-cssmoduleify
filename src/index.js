/* eslint no-use-before-define: 0, no-extra-parens: 0 */
type StateOpts = {
  cssmodule: string;
  modules: "commonjs"|"es6";
};

type State = {
  opts: StateOpts
};

import template from "babel-template";

/**
 * TemplateElement value nodes must be of the shape {raw: string; value: string}
 */
const templateElementValue = (value) => ({raw: value, cooked: value});


export default ({types: t}) => {
  const ROOT_CSSNAMES_IDENTIFIER = "cssmodule";

  /**
   * Generate the required TemplateElements for the following type of template:
   * `${ slot } ${ anotherslot }`
   */
  const spacedTemplateElements = (count) =>
    Array.apply(0, Array(count)).map((_, i) =>
      i === 0 || i === count - 1
        ? t.templateElement(templateElementValue(""), i === count)
        : t.templateElement(templateElementValue(" "), false)
    );

  const isArrayJoin = (path) => {
    return (
      t.isCallExpression(path.node) &&
      t.isMemberExpression(path.node.callee) &&
      t.isIdentifier(path.node.callee.property, {name: "join"}) && (
        t.isArrayExpression(path.node.callee.object) ||
        t.isIdentifier(path.node.callee.object) // TODO: resolve identifier
      )
    );
  };

  /**
   * Resolves a path to most conservative Path to be converted. If there is only
   * one reference to an Identifier we can mutate that safely, otherwise we
   * return the original node to be transformed.
   *
   * @param {Path} path an Identifier or ArrayExpression Path
   * @return {Path} the conservatively resolved path
   */
  const conservativeResolve = (path) => {
    // if it’s not an identifier we already have what we need
    if (!t.isIdentifier(path.node)) {
      return path;
    }
    const binding = path.scope.getBinding(path.node.name);

    // if there is only one reference, we can mutate that directly
    if (binding.references === 1) {
      if (t.isVariableDeclarator(binding.path)) {
        return binding.path.get("init");
      }
      console.warn("TODO: ensure this branch is tracked");
      return binding.path;
    }

    // else we should probably return conservatively only the one we want and
    // transform inline
    return path;
  };

  /**
   * Replaces [...].join(" ") or identifier.join(" ") with the most appropriate
   * cssmodule lookup hash.
   *
   * @param {Path<Identifier|ArrayExpression>} path an Identifier or ArrayExpression Path
   * @param {Node<Identifier>} cssmodule the root identifier to the cssmodules object
   */
  const replaceArrayJoinElements = (path, cssmodule) => {
    const arrayExpressionPath = conservativeResolve(path.get("callee").get("object"));
    if (t.isIdentifier(arrayExpressionPath)) {
      arrayExpressionPath.parent.object =
        t.callExpression(
          t.memberExpression(
            arrayExpressionPath.node,
            t.identifier("map"),
            false
          ),
          [t.arrowFunctionExpression(
            [t.identifier("i")],
            t.memberExpression(cssmodule, t.identifier("i"), true)
          )]
        );
      return;
    }

    for (let i = 0; i < arrayExpressionPath.node.elements.length; i++) {
      const element = arrayExpressionPath.get("elements", i)[i];
      element.replaceWith(computeClassName(element, cssmodule));
    }
  };

  const computeClassName = (value, cssmodule) => {
    if (t.isStringLiteral(value)) {
      const values = value.node.value.split(" ");
      return values.length === 1
        ? t.memberExpression(cssmodule, t.stringLiteral(values[0]), true)
        : t.templateLiteral(
          spacedTemplateElements(values.length + 1),
          values.map((v) => t.memberExpression(cssmodule, t.stringLiteral(v), true))
      );
    } else if (t.isIdentifier(value)) {
      // TODO: need to validate what type of node this identifier refers to
      return t.memberExpression(cssmodule, value.node, true);
    }
  };

  /**
   * Updates a JSX className value with the most appropriate CSS Module lookup.
   *
   * @param {Path} value <jsx className={value} />
   * @param {Node<Identifier>} cssmodule cssmodule identifier
   */
  const updateJSXClassName = (value, cssmodule) => {
    if (t.isJSXExpressionContainer(value)) {
      return updateJSXClassName(value.get("expression"), cssmodule);
    } else if (t.isStringLiteral(value)) {
      return value.replaceWith({
        type: "JSXExpressionContainer",
        expression: computeClassName(value, cssmodule)
      });
    } else if (t.isIdentifier(value)) {
      return value.replaceWith(computeClassName(value, cssmodule));
    } else if (t.isCallExpression(value)) {
      if (isArrayJoin(value)) {
        return replaceArrayJoinElements(value, cssmodule);
      } else {
        console.log("TODO: updateJSXClassName for non [].join(\" \") %s", value.type);
      }
    } else {
      console.log("TODO: updateJSXClassName for %s", value.type);
    }
  };

  const buildRequire = template(`
    const IMPORT_NAME = require(SOURCE);
  `);

  // TODO: template doesn't work for import.
  const buildImport = ({IMPORT_NAME, SOURCE}) =>
    t.importDeclaration(
      [t.importDefaultSpecifier(IMPORT_NAME)], SOURCE
    );

  return {
    visitor: {
      JSXAttribute(path, state) {
        if (path.get("name").node.name !== "className") {
          return;
        }

        if (!state.cssModuleId) {
          state.cssModuleId = path.scope.generateUidIdentifier(ROOT_CSSNAMES_IDENTIFIER);
        }

        updateJSXClassName(path.get("value"), state.cssModuleId);
      },

      Program: {
        exit(path, state:State) {
          if (state.cssModuleId) {
            const importOpts = {
              IMPORT_NAME: state.cssModuleId,
              SOURCE: t.stringLiteral(state.opts.cssmodule)
            };

            path.get("body")[0].insertBefore(
              state.opts.modules === "commonjs"
                ? buildRequire(importOpts)
                : buildImport(importOpts)
            );
          }
        }
      }
    }
  };
};

