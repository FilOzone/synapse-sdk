const path = require('path')

// ESM bundle for modern browsers
module.exports = {
  mode: 'production',
  entry: './dist/browser-entry.js',
  output: {
    path: path.resolve(__dirname, 'dist', 'browser'),
    filename: 'synapse-sdk.esm.js',
    library: {
      type: 'module'
    }
  },
  experiments: {
    outputModule: true
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
    ethers: 'ethers'
  },
  optimization: {
    minimize: true
  }
}
