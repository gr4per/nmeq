const path = require('path');
const TerserPlugin = require("terser-webpack-plugin");

module.exports = {
	entry: './src/nmeq.js',
	output: {
		filename: 'bundle.js',
		path: path.resolve(__dirname, './dist/js')
	},
  mode: 'development',
	module: {
		rules: [{ test: /\.css$/i,
			  use: ["style-loader","css-loader"],
		        },
			{
				test: /.js$/,
				exclude: /node_modules/,
				use: {
					loader: 'babel-loader',
					options: {
            plugins: ["@babel/plugin-proposal-class-properties", "@babel/transform-runtime"],
						presets: [
              "@babel/env",
              "@babel/preset-react"
            ],
            cacheDirectory: true
					}
				}
			}
		]
	},
  optimization: {
    minimize: false,
    minimizer: [
      new TerserPlugin({
        cache: true,
        parallel: true,
        sourceMap: true, // Must be set to true if using source-maps in production
        terserOptions: {
          // https://github.com/webpack-contrib/terser-webpack-plugin#terseroptions
          output:{
            comments: false,
          },
          compress: {
               //drop_console: true,
          },
          extractComments:false,
        }
      }),
    ],    
  },
  devServer: {
    static: './dist',
    hot: true,
    compress: true,
    port: 9000,
  }
};
