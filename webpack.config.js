const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
    // Define entry points for each HTML page's main JavaScript file
    entry: {
        login: './src/js/login.js',
        main: './src/js/main.js',
        profile: './src/js/profile.js',
        admin: './src/js/admin.js',
        // NEW: User Dashboard entry
        dashboard: './src/js/dashboard.js', 
    },
    output: {
        filename: 'js/[name].[contenthash].js', // Output JS files into a 'js' subfolder in 'dist'
        path: path.resolve(__dirname, 'dist'),
        clean: true, // Clean the dist folder before each build
    },
    devServer: {
        static: {
            directory: path.resolve(__dirname, 'dist'),
        },
        compress: true,
        port: 8080,
        open: ['/login.html'], // Automatically open the login page
        hot: true, // Enable Hot Module Replacement
    },
    module: {
        rules: [
            {
                test: /\.css$/i,
                use: ['style-loader', 'css-loader', 'postcss-loader'],
            },
            {
                // NEW: Rule for JavaScript files using Babel
                test: /\.js$/, // Apply this rule to .js files
                exclude: /node_modules/, // Exclude node_modules to speed up compilation
                use: {
                    loader: 'babel-loader', // Use babel-loader
                    options: {
                        presets: ['@babel/preset-env'], // Use preset-env for modern JS features
                    },
                },
            },
        ],
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: './src/login.html',
            filename: 'login.html',
            chunks: ['login'], // Inject only login.js bundle
        }),
        new HtmlWebpackPlugin({
            template: './src/index.html',
            filename: 'index.html',
            chunks: ['main'], // Inject only main.js bundle
        }),
        new HtmlWebpackPlugin({
            template: './src/profile.html',
            filename: 'profile.html',
            chunks: ['profile'], // Inject only profile.js bundle
        }),
        new HtmlWebpackPlugin({
            template: './src/admin.html',
            filename: 'admin.html',
            chunks: ['admin'], // Inject only admin.js bundle
        }),
        // NEW: User Dashboard HTML file
        new HtmlWebpackPlugin({
            template: './src/dashboard.html',
            filename: 'dashboard.html',
            chunks: ['dashboard'],
        }),
    ],
    resolve: {
        extensions: ['.js', '.json'],
    },
    devtool: 'eval-source-map', // Generates source maps for easier debugging in development
};
