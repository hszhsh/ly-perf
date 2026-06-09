import path from "node:path";
import { Configuration } from "@rspack/core";
import HtmlRspackPlugin from "html-rspack-plugin";
import { ReactRefreshRspackPlugin } from "@rspack/plugin-react-refresh";

const isDev = process.env.NODE_ENV !== "production";
const devPort = Number(process.env.DEV_SERVER_PORT ?? 3173);

const config: Configuration = {
    mode: isDev ? "development" : "production",
    target: "web",
    entry: {
        renderer: path.resolve(__dirname, "src/renderer/index.tsx")
    },
    output: {
        path: path.resolve(__dirname, ".rspack/renderer"),
        filename: "[name].js",
        chunkFilename: isDev ? "[name].chunk.js" : "[name].[contenthash:8].js",
        publicPath: isDev ? "/" : "./"
    },
    resolve: {
        alias: {
            "@renderer": path.resolve(__dirname, "src/renderer"),
            "@shared": path.resolve(__dirname, "src/shared")
        },
        extensions: [".ts", ".tsx", ".js", ".jsx"]
    },
    devtool: isDev ? "cheap-module-source-map" : "source-map",
    module: {
        rules: [
            {
                test: /\.[jt]sx?$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: "babel-loader",
                        options: {
                            cacheDirectory: true
                        }
                    }
                ],
                type: "javascript/auto"
            },
            {
                test: /\.module\.css$/,
                use: [
                    "style-loader",
                    {
                        loader: "css-loader",
                        options: {
                            modules: {
                                namedExport: false,
                                localIdentName: isDev
                                    ? "[name]__[local]__[hash:base64:5]"
                                    : "[hash:base64:8]"
                            }
                        }
                    }
                ]
            },
            {
                test: /\.css$/,
                exclude: /\.module\.css$/,
                use: ["style-loader", "css-loader"]
            },
            {
                test: /\.(png|jpg|jpeg|gif|svg)$/i,
                type: "asset/resource"
            }
        ]
    },
    plugins: [
        new HtmlRspackPlugin({
            template: path.resolve(__dirname, "public/index.html"),
            filename: "index.html"
        }),
        isDev && new ReactRefreshRspackPlugin()
    ].filter(Boolean) as Configuration["plugins"],
    devServer: {
        port: devPort,
        hot: true,
        historyApiFallback: true,
        static: {
            directory: path.resolve(__dirname, "public")
        },
        client: {
            overlay: true
        }
    }
};

export default config;
