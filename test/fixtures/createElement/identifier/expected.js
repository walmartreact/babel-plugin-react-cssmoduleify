import _cssmodule from "path/to/classnames.css";
import React from "react";
const base = "base";

export default class extends React.Component {
  render() {
    return React.createElement("div", { className: _cssmodule[base] }, "Base test.");
  }
};


