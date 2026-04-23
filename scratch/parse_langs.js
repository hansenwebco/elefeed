const html = `REPLACE_WITH_USER_HTML`;
const regex = /data-index="([^"]+)"[^>]*><span[^>]*>([^<]+)<\/span> <span[^>]*>\(([^)]+)\)<\/span>/g;
let match;
const langMap = {};
while ((match = regex.exec(html)) !== null) {
  langMap[match[1]] = match[3];
}
console.log(JSON.stringify(langMap, null, 2));
