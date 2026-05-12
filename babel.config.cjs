module.exports = function babelConfig(api) {
  api.cache(true);

  const isDev = process.env.NODE_ENV !== "production";
  const reactCompilerConfig = {
    panicThreshold: "none"
  };

  return {
    presets: [
      ["@babel/preset-env", { targets: { chrome: "120" } }],
      ["@babel/preset-react", { runtime: "automatic", development: isDev }],
      "@babel/preset-typescript"
    ],
    plugins: [
      ["babel-plugin-react-compiler", reactCompilerConfig],
      isDev && "react-refresh/babel"
    ].filter(Boolean)
  };
};
