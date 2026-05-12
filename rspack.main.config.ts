import path from "node:path";
import { Configuration } from "@rspack/core";

const isDev = process.env.NODE_ENV !== "production";

const config: Configuration = {
  mode: isDev ? "development" : "production",
  target: "electron-main",
  entry: {
    main: path.resolve(__dirname, "src/main/main.ts"),
    preload: path.resolve(__dirname, "src/main/preload.ts")
  },
  output: {
    path: path.resolve(__dirname, ".rspack/main"),
    filename: "[name].js",
    clean: true
  },
  resolve: {
    alias: {
      "@main": path.resolve(__dirname, "src/main"),
      "@shared": path.resolve(__dirname, "src/shared")
    },
    extensions: [".ts", ".js", ".json"]
  },
  devtool: isDev ? "inline-source-map" : "source-map",
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        loader: "builtin:swc-loader",
        options: {
          jsc: {
            parser: {
              syntax: "typescript"
            },
            target: "es2022"
          }
        }
      }
    ]
  },
  node: {
    __dirname: false,
    __filename: false
  }
};

export default config;
