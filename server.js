// node-fetch v2 — CommonJS compatible, avoids Node 18 undici/File issues
const fetch  = require('node-fetch');
global.fetch = fetch;

const app  = require('./app');

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅  RedCube SEO API running on :${PORT}`));
