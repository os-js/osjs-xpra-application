module.exports = function(api) {
  api.cache(() => process.env.NODE_ENV === 'production');

  return {
    presets: ['@babel/preset-env'],
    plugins: ['@babel/plugin-transform-runtime']
  };
};
