import type { AppData, Documento, TipoDocumento, TipoImpuesto } from './types';

export const impuestos: Record<TipoImpuesto, { label: string; rate: number }> = {
  IGIC_7: { label: 'IGIC 7%', rate: 7 },
  IGIC_3: { label: 'IGIC 3%', rate: 3 },
  IGIC_0: { label: 'IGIC 0%', rate: 0 },
  EXENTO: { label: 'Exento', rate: 0 }
};

export function formatNumber(prefix: string, next: number, digits: number) {
  return `${prefix}${String(next).padStart(Math.max(1, digits), '0')}`;
}

export function nextDocumentNumber(data: AppData, tipo: TipoDocumento) {
  const cfg = data.empresa.numeracion;
  return tipo === 'factura'
    ? formatNumber(cfg.prefijoFactura, cfg.siguienteFactura, cfg.digitos)
    : formatNumber(cfg.prefijoPresupuesto, cfg.siguientePresupuesto, cfg.digitos);
}

export function incrementNumbering(data: AppData, tipo: TipoDocumento): AppData {
  const cfg = data.empresa.numeracion;
  return {
    ...data,
    empresa: {
      ...data.empresa,
      numeracion: tipo === 'factura'
        ? { ...cfg, siguienteFactura: cfg.siguienteFactura + 1 }
        : { ...cfg, siguientePresupuesto: cfg.siguientePresupuesto + 1 }
    }
  };
}

export function duplicateNumber(data: AppData, doc: Documento) {
  return data.documentos.some(d => d.id !== doc.id && d.tipo === doc.tipo && d.numero.trim().toUpperCase() === doc.numero.trim().toUpperCase());
}

export function totals(doc: Documento) {
  const base = doc.lineas.reduce((s, l) => s + Number(l.cantidad || 0) * Number(l.precio || 0), 0);
  const igic = doc.lineas.reduce((s, l) => s + Number(l.cantidad || 0) * Number(l.precio || 0) * (impuestos[l.impuesto].rate / 100), 0);
  return { base: round(base), igic: round(igic), total: round(base + igic) };
}

export async function sha256(text: string) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function canonicalInvoice(data: AppData, doc: Documento, hashAnterior = '') {
  const cliente = data.clientes.find(c => c.id === doc.clienteId);
  const t = totals(doc);
  return [
    `emisor_nif=${data.empresa.nif}`,
    `emisor_nombre=${data.empresa.nombre}`,
    `numero=${doc.numero}`,
    `fecha=${doc.fecha}`,
    `destinatario_nif=${cliente?.nif ?? ''}`,
    `destinatario_nombre=${cliente?.nombre ?? ''}`,
    `base=${t.base.toFixed(2)}`,
    `igic=${t.igic.toFixed(2)}`,
    `total=${t.total.toFixed(2)}`,
    `hash_anterior=${hashAnterior}`,
    `certificado=${data.empresa.certificadoThumbprint ?? ''}`
  ].join('&');
}

export async function emitirFactura(data: AppData, doc: Documento) {
  const emitidas = data.documentos.filter(d => d.tipo === 'factura' && d.estado === 'emitida' && d.hashActual && d.id !== doc.id);
  const anterior = emitidas.length ? emitidas[emitidas.length - 1].hashActual ?? '' : '';
  const canonical = canonicalInvoice(data, doc, anterior);
  const hash = await sha256(canonical);
  const qr = buildQr(data, doc, hash);
  const xml = buildVerifactuXml(data, doc, anterior, hash);
  return { ...doc, estado: 'emitida' as const, hashAnterior: anterior, hashActual: hash, qr, verifactuEstado: 'generado' as const, verifactuXml: xml };
}

export function buildQr(data: AppData, doc: Documento, hash: string) {
  const t = totals(doc);
  const params = new URLSearchParams({ nif: data.empresa.nif, numSerie: doc.numero, fecha: doc.fecha, importe: t.total.toFixed(2), huella: hash });
  return `https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?${params.toString()}`;
}

export function buildVerifactuXml(data: AppData, doc: Documento, hashAnterior = '', hashActual = doc.hashActual ?? '') {
  const cliente = data.clientes.find(c => c.id === doc.clienteId);
  const t = totals(doc);
  const esc = (v?: string | number) => String(v ?? '').replace(/[<>&'\"]/g, ch => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', "'":'&apos;', '"':'&quot;' }[ch] ?? ch));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<RegistroFacturacionAlta>\n  <Sistema>Facturas JG</Sistema>\n  <Modo>${esc(data.empresa.verifactuModo ?? 'pendiente')}</Modo>\n  <CertificadoThumbprint>${esc(data.empresa.certificadoThumbprint)}</CertificadoThumbprint>\n  <Emisor>\n    <Nombre>${esc(data.empresa.nombre)}</Nombre>\n    <NIF>${esc(data.empresa.nif)}</NIF>\n  </Emisor>\n  <Destinatario>\n    <Nombre>${esc(cliente?.nombre)}</Nombre>\n    <NIF>${esc(cliente?.nif)}</NIF>\n  </Destinatario>\n  <Factura>\n    <Numero>${esc(doc.numero)}</Numero>\n    <Fecha>${esc(doc.fecha)}</Fecha>\n    <Impuesto>IGIC</Impuesto>\n    <Base>${t.base.toFixed(2)}</Base>\n    <CuotaIGIC>${t.igic.toFixed(2)}</CuotaIGIC>\n    <Total>${t.total.toFixed(2)}</Total>\n    <HashAnterior>${esc(hashAnterior)}</HashAnterior>\n    <HashActual>${esc(hashActual)}</HashActual>\n  </Factura>\n</RegistroFacturacionAlta>`;
}

export function convertirPresupuestoAFactura(data: AppData, doc: Documento): Documento {
  return {
    ...doc,
    id: crypto.randomUUID(),
    tipo: 'factura',
    numero: nextDocumentNumber(data, 'factura'),
    estado: 'borrador',
    hashAnterior: undefined,
    hashActual: undefined,
    qr: undefined,
    verifactuEstado: 'pendiente',
    verifactuXml: undefined,
    verifactuRespuesta: undefined,
    verifactuCsv: undefined
  };
}

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
