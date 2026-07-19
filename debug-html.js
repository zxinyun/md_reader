var fs = require('fs');
var h = fs.readFileSync('E:/md-reader/public/index.html', 'utf8');

// Find action strip HTML
var idx = h.indexOf('action-strip');
if (idx >= 0) {
  // Go backwards to find the div start
  var s = h.lastIndexOf('<div', idx);
  // Go forwards to find the closing div
  var depth = 1;
  var e = h.indexOf('>', idx);
  while (e < h.length && depth > 0) {
    e++;
    var nextOpen = h.indexOf('<div', e);
    var nextClose = h.indexOf('</div>', e);
    if (nextClose < 0) break;
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth++;
      e = nextOpen + 5;
    } else {
      depth--;
      e = nextClose + 6;
    }
  }
  console.log('Action strip HTML:');
  console.log(h.substring(s, e));
}
