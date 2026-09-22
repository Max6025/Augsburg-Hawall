// Ein kleiner Markdown-Satz fuer Texte, die der Nutzer selbst eintippt.
//
// Herkunft: Er stammt aus dem Ankunftsschirm der Vorlage (Italien Wall Display). Der Schirm ist
// weg, der Markdown nicht -- die Ankuendigungsbox benutzt ihn weiter, und der Bildschirmschoner
// wird es tun. Er steht deshalb jetzt fuer sich.
//
// Sicherheitsprinzip: Erst wird ALLES maskiert, danach werden ausschliesslich die eigenen
// Auszeichnungen wieder zu Tags. So kann aus dem Text nie HTML entstehen, das jemand
// hineingeschrieben hat -- auch nicht ueber einen Umweg. Wer hier eine Auszeichnung ergaenzt,
// haelt diese Reihenfolge ein.

(function (global) {
  'use strict';

  // Absichtlich ueber Zeichencodes statt ueber Maskierungen: Diese Datei wird von Skripten
  // erzeugt und veraendert, und eine zerbrochene Maskierung faellt erst zur Laufzeit auf.
  const NEUE_ZEILE = new RegExp(String.fromCharCode(13) + '?' + String.fromCharCode(10));

  /**
   * Auszeichnungen innerhalb einer Zeile. Wird sowohl vom Fliesstext als auch von der
   * Ueberschrift genutzt -- damit laesst sich "Herzlich **willkommen**" schreiben und man
   * bekommt dieselbe Zweiteilung wie in der Entwurfsvorlage.
   */
  function inlineMarkdown(roh, escFn) {
    const esc = escFn || (v => String(v == null ? '' : v));
    let t = esc(roh);
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    t = t.replace(/_([^_]+)_/g, '<em>$1</em>');
    // Nur http und https -- alles andere waere ein Einfallstor.
    t = t.replace(/\[([^\]]+)\]\((https?:&#x2F;&#x2F;[^)\s]+|https?:\/\/[^)\s]+)\)/g,
      (m, txt, url) => `<a href="${url.replace(/&#x2F;/g, '/')}" rel="noopener">${txt}</a>`);
    return t;
  }

  function markdown(text, escFn) {
    const esc = escFn || (v => String(v == null ? '' : v));
    const zeilen = String(text || '').split(NEUE_ZEILE);
    const raus = [];
    let liste = false;

    const inline = (roh) => inlineMarkdown(roh, esc);

    const listeSchliessen = () => { if (liste) { raus.push('</ul>'); liste = false; } };

    for (const zeile of zeilen) {
      const z = zeile.trim();
      if (!z) { listeSchliessen(); continue; }
      const punkt = z.match(/^[-*+]\s+(.*)$/);
      if (punkt) {
        if (!liste) { raus.push('<ul>'); liste = true; }
        raus.push('<li>' + inline(punkt[1]) + '</li>');
        continue;
      }
      listeSchliessen();
      const ueberschrift = z.match(/^(#{1,3})\s+(.*)$/);
      if (ueberschrift) {
        const stufe = ueberschrift[1].length + 1; // h2 bis h4, h1 gehoert der Ueberschrift oben
        raus.push(`<h${stufe}>` + inline(ueberschrift[2]) + `</h${stufe}>`);
        continue;
      }
      raus.push('<p>' + inline(z) + '</p>');
    }
    listeSchliessen();
    return raus.join('');
  }

  const api = { markdown, inlineMarkdown };
  global.MarkdownModul = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
