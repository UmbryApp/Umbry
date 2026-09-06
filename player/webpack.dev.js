const { merge } = require('webpack-merge');
const common = require('./webpack.common');

module.exports = merge(common, {
    target: process.env.WEBPACK_SERVE ? 'web' : 'browserslist',
    mode: 'development',
    devtool: 'eval-cheap-module-source-map',
    module: {
        rules: [
            { test: /\.(js|jsx|ts|tsx)$/, exclude: /node_modules/, enforce: 'pre', use: ['source-map-loader'] }
        ]
    },
    devServer: {
        compress: true,
        host: '0.0.0.0',
        port: 8081,
        allowedHosts: 'all',
        client: { overlay: false },
        proxy: [
            // Requests feature: forward /seerr-api/* to the Jellyseerr backend (dev-time proxy;
            // in production this becomes a controller in the Umbry server).
            {
                context: ['/seerr-api'],
                target: 'http://localhost:5055',
                changeOrigin: true,
                secure: true,
                pathRewrite: { '^/seerr-api': '/api/v1' },
                // rewrite the Jellyseerr session cookie so it's stored for our origin
                cookieDomainRewrite: '',
                cookiePathRewrite: '/'
            },
            // Everything Jellyfin (capitalised routes + socket) -> the media server on 8097
            {
                context: (p) => (/^\/[A-Z]/).test(p) || p.startsWith('/socket'),
                target: 'http://localhost:8096',
                changeOrigin: true,
                ws: true
            }
        ]
    }
});
