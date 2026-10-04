import { describe, expect, it } from 'vitest';
import { htmlToText, smsIsTooLong } from '../src/utils.js';

describe('htmlToText', () => {
  it('strips tags, converts breaks/block-ends to newlines, unescapes entities', () => {
    const html = '<style>.x{color:red}</style><script>alert(1)</script><p>Hello&nbsp;&amp;<br>Bye</p>';
    expect(htmlToText(html)).toBe('Hello &\nBye');
  });

  it('collapses 3+ newlines down to 2 and trims', () => {
    const html = '<p>a</p><p></p><p></p><p>b</p>';
    expect(htmlToText(html)).toBe('a\n\nb');
  });

  it('unescapes <, >, quotes', () => {
    expect(htmlToText('&lt;b&gt; &quot;hi&quot; &#39;x&#39;')).toBe('<b> "hi" \'x\'');
  });
});

describe('smsIsTooLong', () => {
  it('GSM-7 text: false at 918 chars, true just past it', () => {
    expect(smsIsTooLong('a'.repeat(918))).toBe(false);
    expect(smsIsTooLong('a'.repeat(919))).toBe(true);
  });

  it('Unicode text (a non-ASCII char forces the Unicode branch): false at 402 chars, true past it', () => {
    // 'é' is a single UTF-16 code unit (unlike an emoji, which is a surrogate
    // pair of length 2), so it cleanly exercises the 402-char boundary.
    expect(smsIsTooLong('é' + 'a'.repeat(401))).toBe(false); // length 402
    expect(smsIsTooLong('é' + 'a'.repeat(402))).toBe(true); // length 403
  });
});
