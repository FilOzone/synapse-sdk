const path = require('path')

module.exports = {
  mode: 'production',
  entry: './dist/browser-entry.js',
  output: {
    path: path.resolve(__dirname, 'dist', 'browser'),
    filename: 'synapse-sdk.min.js',
    library: {
      name: 'SynapseSDK',
      type: 'umd',
      export: 'default',
      umdNamedDefine: true
    },
    globalObject: 'this'
  },
  resolve: {
    extensions: ['.js'],
    fallback: {
      // Node.js polyfills that ethers might need
      crypto: false,
      stream: false,
      assert: false,
      http: false,
      https: false,
      os: false,
      url: false,
      buffer: false,
      process: false
    }
  },
  externals: {
    // Don't bundle ethers - users should provide it
    ethers: {
      commonjs: 'ethers',
      commonjs2: 'ethers',
      amd: 'ethers',
      root: 'ethers'
    }
  },
  optimization: {
    minimize: true
  }
}
