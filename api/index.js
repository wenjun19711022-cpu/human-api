'use strict';
const { handleApi } = require('../src/api');
module.exports = async (req, res) => {
  if (await handleApi(req, res)) return;
  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'not found' }));
};
