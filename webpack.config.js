const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const mode = process.env.NODE_ENV || 'development';
const minimize = mode === 'production';

module.exports = {
  mode,
  devtool: 'source-map',
  entry: [
    path.resolve(__dirname, 'index.js'),
  ],
  plugins: [
    new CopyWebpackPlugin([
      'node_modules/xpra-html5-client/build/worker.js',
      'node_modules/xpra-html5-client/build/worker.js.map',
      'logo.png'
    ])
  ],
  optimization: {
    minimize,
  },
  externals: {
    osjs: 'OSjs'
  },
  module: {
    rules: [
      {
        test: /\.(svg|png|jpe?g|gif|webp)$/,
        exclude: /(node_modules|bower_components)/,
        use: [
          {
            loader: 'file-loader'
          }
        ]
      },
      {
        test: /\.js$/,
        exclude: /node_modules\/(?!@osjs)/,
        use: {
          loader: 'babel-loader'
        }
      }
    ]
  }
};
