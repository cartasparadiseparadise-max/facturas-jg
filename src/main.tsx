import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { ArchiveRestore, Building2, Download, FileDown, FileText, ImagePlus, Mail, Plus, ReceiptText, RefreshCw, Save, Search, Send, ShieldCheck, Trash2, Upload, Users } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { jsPDF } from 'jspdf';
import { sampleData } from './lib/sampleData';
import type { AppData, CertificadoWindows, Cliente, Documento, LineaDocumento, TipoDocumento, TipoImpuesto } from './lib/types';
import { buildVerifactuXml, convertirPresupuestoAFactura, duplicateNumber, emitirFactura, impuestos, incrementNumbering, nextDocumentNumber, totals } from './lib/verifactu';
import './styles.css';

type Tab = 'empresa' | 'clientes' | 'facturas' | 'presupuestos' | 'verifactu' | 'copias';
type VerifactuSendResponse = { estado:string; csv:string; mensaje:string; ruta_xml:string; enviado_en:string };

const today = () => new Date().toISOString().slice(0, 10);
const blankCliente = (): Cliente => ({ id: crypto.randomUUID(), nombre: '', nif: '', direccion: '', codigoPostal: '', ciudad: '', provincia: 'Las Palmas / Santa Cruz de Tenerife', telefono: '', email: '' });
const blankLinea = (impuesto: TipoImpuesto): LineaDocumento => ({ id: crypto.randomUUID(), descripcion: 'Servicio', cantidad: 1, precio: 0, impuesto });

function migrateData(raw: AppData): AppData {
  return {
    ...sampleData,
    ...raw,
    empresa: {
      ...sampleData.empresa,
      ...raw.empresa,
      numeracion: { ...sampleData.empresa.numeracion, ...(raw.empresa as any)?.numeracion }
    },
    clientes: raw.clientes ?? [],
    documentos: (raw.documentos ?? []).map((d: any) => ({ ...d, numero: String(d.numero ?? `${d.serie ?? ''}${d.numero ?? ''}`) }))
  };
}

function App() {
  const [data, setData] = useState<AppData>(sampleData);
  const [tab, setTab] = useState<Tab>('empresa');
  const [selectedClienteId, setSelectedClienteId] = useState<string>('');
  const [selectedDocId, setSelectedDocId] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [clienteSearch, setClienteSearch] = useState<string>('');
  const [docSearch, setDocSearch] = useState<string>('');

  useEffect(() => { (async () => {
    try {
      const raw = await invoke<string | null>('load_data');
      if (raw) setData(migrateData(JSON.parse(raw)));
    } catch {
      const raw = localStorage.getItem('facturas-jg');
      if (raw) setData(migrateData(JSON.parse(raw)));
    }
  })(); }, []);

  async function persist(next: AppData) {
    setData(next);
    localStorage.setItem('facturas-jg', JSON.stringify(next));
    try { await invoke('save_data', { payload: JSON.stringify(next, null, 2) }); } catch {}
  }

  const docsBase = data.documentos.filter(d => d.tipo === (tab === 'presupuestos' ? 'presupuesto' : 'factura'));
  const docs = docsBase.filter(d => {
    const q = docSearch.trim().toLowerCase();
    if (!q) return true;
    const cliente = data.clientes.find(c => c.id === d.clienteId);
    return [d.numero, d.estado, d.fecha, String(totals(d).total), cliente?.nombre, cliente?.nif, cliente?.email]
      .filter(Boolean)
      .some(v => String(v).toLowerCase().includes(q));
  });
  const selectedDoc = data.documentos.find(d => d.id === selectedDocId) ?? docs[docs.length - 1];
  const selectedCliente = data.clientes.find(c => c.id === selectedClienteId) ?? data.clientes[0];
  const totalEmitido = useMemo(() => data.documentos.filter(d => d.tipo === 'factura' && d.estado === 'emitida').reduce((s, d) => s + totals(d).total, 0), [data.documentos]);

  function updateEmpresa(field: keyof AppData['empresa'], value: any) { persist({ ...data, empresa: { ...data.empresa, [field]: value } }); }
  function updateNumeracion(field: keyof AppData['empresa']['numeracion'], value: any) { persist({ ...data, empresa: { ...data.empresa, numeracion: { ...data.empresa.numeracion, [field]: value } } }); }
  async function uploadLogo(file?: File) { if (!file) return; const reader = new FileReader(); reader.onload = () => updateEmpresa('logo', String(reader.result)); reader.readAsDataURL(file); }

  function nuevoCliente() { const c = blankCliente(); persist({ ...data, clientes: [...data.clientes, c] }); setSelectedClienteId(c.id); setTab('clientes'); }
  function updateCliente(id: string, field: keyof Cliente, value: string) { persist({ ...data, clientes: data.clientes.map(c => c.id === id ? { ...c, [field]: value } : c) }); }
  function borrarCliente(id: string) { if (!confirm('¿Eliminar este cliente?')) return; persist({ ...data, clientes: data.clientes.filter(c => c.id !== id) }); setSelectedClienteId(''); }

  function nuevoDocumento(tipo: TipoDocumento) {
    const numero = nextDocumentNumber(data, tipo);
    const doc: Documento = { id: crypto.randomUUID(), tipo, numero, clienteId: data.clientes[0]?.id ?? '', fecha: today(), estado: 'borrador', lineas: [blankLinea(data.empresa.regimen)], verifactuEstado: tipo === 'factura' ? 'pendiente' : undefined };
    const next = incrementNumbering({ ...data, documentos: [...data.documentos, doc] }, tipo);
    persist(next); setSelectedDocId(doc.id); setTab(tipo === 'factura' ? 'facturas' : 'presupuestos');
  }
  function updateDoc(doc: Documento) { persist({ ...data, documentos: data.documentos.map(d => d.id === doc.id ? doc : d) }); }
  function borrarDocumento(doc: Documento) { if (!confirm(`¿Borrar ${doc.tipo} ${doc.numero}?`)) return; persist({ ...data, documentos: data.documentos.filter(d => d.id !== doc.id) }); setSelectedDocId(''); }
  async function emitir(doc: Documento) {
    if (duplicateNumber(data, doc)) return alert('Número duplicado. Cambia el número antes de emitir.');
    let emitida: Documento = await emitirFactura(data, doc);
    if (data.empresa.verifactuAutoEnviar) {
      emitida = await enviarAEAT(emitida, false);
    } else {
      try { await invoke<string>('save_verifactu_xml', { numero: emitida.numero, xml: emitida.verifactuXml ?? buildVerifactuXml(data, emitida, emitida.hashAnterior, emitida.hashActual) }); } catch {}
    }
    updateDoc(emitida);
  }
  function convertir(doc: Documento) { const factura = convertirPresupuestoAFactura(data, doc); let next = { ...data, documentos: [...data.documentos, factura] }; next = incrementNumbering(next, 'factura'); persist(next); setSelectedDocId(factura.id); setTab('facturas'); }

  function descargarXML(doc: Documento) { const xml = doc.verifactuXml || buildVerifactuXml(data, doc, doc.hashAnterior, doc.hashActual); downloadText(`verifactu-${doc.numero}.xml`, xml, 'application/xml'); }

  async function enviarAEAT(doc: Documento, persistir = true): Promise<Documento> {
    const xml = doc.verifactuXml || buildVerifactuXml(data, doc, doc.hashAnterior, doc.hashActual);
    const endpoint = data.empresa.verifactuModo === 'produccion' ? data.empresa.verifactuEndpointProduccion : data.empresa.verifactuEndpointPruebas;
    try {
      const res = await invoke<VerifactuSendResponse>('send_verifactu_record', { req: { numero: doc.numero, xml, endpoint, modo: data.empresa.verifactuModo ?? 'pendiente', certificado_thumbprint: data.empresa.certificadoThumbprint } });
      const next: Documento = { ...doc, verifactuXml: xml, verifactuEstado: res.estado === 'generado' ? 'generado' : 'firmado', verifactuRespuesta: res.mensaje + `\nRuta XML: ${res.ruta_xml}`, verifactuCsv: res.csv, verifactuUltimoEnvio: res.enviado_en };
      if (persistir) updateDoc(next);
      setStatus(res.mensaje);
      return next;
    } catch (e) {
      const next: Documento = { ...doc, verifactuXml: xml, verifactuEstado: 'error', verifactuRespuesta: String(e), verifactuUltimoEnvio: new Date().toISOString() };
      if (persistir) updateDoc(next);
      setStatus(`Error Veri*Factu: ${e}`);
      return next;
    }
  }
  function descargarBackupLocal() { downloadText(`facturas-jg-backup-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(data, null, 2), 'application/json'); }
  async function crearBackupAppData() { try { const path = await invoke<string>('create_backup'); setStatus(`Copia creada: ${path}`); } catch (e) { setStatus(`No se pudo crear copia: ${e}`); } }
  async function restaurarBackup(file?: File) { if (!file) return; const text = await file.text(); const restored = migrateData(JSON.parse(text)); await persist(restored); setStatus('Copia restaurada correctamente.'); }

  function descargarPDF(doc: Documento) {
    const cliente = data.clientes.find(c => c.id === doc.clienteId);
    const t = totals(doc);

    const pdf = new jsPDF('p', 'mm', 'a4');
    const azul = [25, 76, 180] as const;
    const gris = [245, 247, 250] as const;
    const titulo = doc.tipo === 'factura' ? 'FACTURA' : 'PRESUPUESTO';
    const nombreEmpresa = data.empresa.nombre || 'INSTALACIONES JOSE GUERRA';

    // Barra superior
    pdf.setFillColor(...azul);
    pdf.rect(0, 0, 210, 18, 'F');

    // Logo
    let logoOk = false;
    if (data.empresa.logo) {
      try {
        const format =
          data.empresa.logo.includes('image/jpeg') ||
          data.empresa.logo.includes('image/jpg')
            ? 'JPEG'
            : 'PNG';

        pdf.addImage(data.empresa.logo, format, 14, 26, 34, 28);
        logoOk = true;
      } catch {
        try {
          pdf.addImage(data.empresa.logo, 'JPEG', 14, 26, 34, 28);
          logoOk = true;
        } catch {}
      }
    }

    // Cabecera empresa
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(...azul);
    pdf.setFontSize(22);
    pdf.text('INSTALACIONES', logoOk ? 55 : 14, 34);
    pdf.setFontSize(25);
    pdf.text('JOSE GUERRA', logoOk ? 55 : 14, 46);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(70, 70, 70);

    const empresaInfo = [
      data.empresa.direccion,
      `${data.empresa.codigoPostal || ''} ${data.empresa.ciudad || ''}`.trim(),
      data.empresa.telefono,
      data.empresa.email
    ].filter(Boolean);

    let ey = 30;
    empresaInfo.forEach(linea => {
      pdf.text(String(linea), 142, ey);
      ey += 6;
    });

    pdf.setDrawColor(...azul);
    pdf.setLineWidth(0.6);
    pdf.line(14, 66, 196, 66);

    // Título documento
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(20, 20, 20);
    pdf.setFontSize(28);
    pdf.text(titulo, 14, 86);

    // Caja número
    pdf.setFillColor(...azul);
    pdf.roundedRect(146, 74, 50, 25, 3, 3, 'F');

    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(10);
    pdf.text(`Nº ${titulo}`, 154, 83);
    pdf.setFontSize(18);
    pdf.text(doc.numero, 153, 95);

    pdf.setTextColor(40, 40, 40);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(11);
    pdf.text(`Fecha: ${formatPdfDate(doc.fecha)}`, 16, 102);

    if (doc.tipo === 'presupuesto') {
      pdf.text('Validez: 30 días', 16, 110);
    }

    // Caja emisor
    pdf.setFillColor(...gris);
    pdf.setDrawColor(210, 220, 230);
    pdf.roundedRect(14, 122, 86, 54, 3, 3, 'FD');

    pdf.setFillColor(...azul);
    pdf.roundedRect(18, 116, 29, 9, 2, 2, 'F');

    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.text('EMISOR', 22, 122);

    pdf.setTextColor(25, 25, 25);
    pdf.setFontSize(10);
    pdf.text(nombreEmpresa, 18, 136);

    pdf.setFont('helvetica', 'normal');
    pdf.text(`CIF/NIF: ${data.empresa.nif || ''}`, 18, 144);
    pdf.text(data.empresa.direccion || '', 18, 152);
    pdf.text(`${data.empresa.codigoPostal || ''} ${data.empresa.ciudad || ''}`.trim(), 18, 160);
    pdf.text(data.empresa.telefono || '', 18, 168);
    pdf.text(data.empresa.email || '', 18, 174);

    // Caja cliente
    pdf.setFillColor(...gris);
    pdf.setDrawColor(210, 220, 230);
    pdf.roundedRect(108, 122, 88, 54, 3, 3, 'FD');

    pdf.setFillColor(...azul);
    pdf.roundedRect(112, 116, 31, 9, 2, 2, 'F');

    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.text('CLIENTE', 116, 122);

    pdf.setTextColor(25, 25, 25);
    pdf.setFontSize(10);
    pdf.text(cliente?.nombre || 'Sin cliente', 112, 136);

    pdf.setFont('helvetica', 'normal');
    pdf.text(cliente?.nif || '', 112, 144);
    pdf.text(cliente?.direccion || '', 112, 152);
    pdf.text(`${cliente?.codigoPostal ?? ''} ${cliente?.ciudad ?? ''}`.trim(), 112, 160);
    pdf.text(cliente?.telefono || '', 112, 168);
    pdf.text(cliente?.email || '', 112, 174);

    // Tabla
    let y = 194;

    pdf.setFillColor(...azul);
    pdf.roundedRect(14, y, 182, 10, 2, 2, 'F');

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(255, 255, 255);
    pdf.text('CONCEPTO', 18, y + 6.5);
    pdf.text('CANT.', 106, y + 6.5);
    pdf.text('PRECIO', 127, y + 6.5);
    pdf.text('IGIC', 153, y + 6.5);
    pdf.text('TOTAL', 177, y + 6.5);

    y += 14;

    pdf.setTextColor(30, 30, 30);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);

    doc.lineas.forEach((l, index) => {
      const totalLinea =
        Number(l.cantidad) *
        Number(l.precio) *
        (1 + impuestos[l.impuesto].rate / 100);

      if (index % 2 === 0) {
        pdf.setFillColor(250, 252, 255);
        pdf.rect(14, y - 6, 182, 9, 'F');
      }

      pdf.text(String(l.descripcion || '').slice(0, 55), 18, y);
      pdf.text(String(l.cantidad || 0), 108, y);
      pdf.text(`${Number(l.precio || 0).toFixed(2)} €`, 127, y);
      pdf.text(impuestos[l.impuesto].label.replace('IGIC ', ''), 153, y);
      pdf.text(`${totalLinea.toFixed(2)} €`, 177, y);

      y += 10;
    });

    y += 8;

    // Observaciones, sin firma
    pdf.setDrawColor(225, 225, 225);
    pdf.setFillColor(250, 252, 255);
    pdf.roundedRect(14, y, 82, 32, 3, 3, 'FD');

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(...azul);
    pdf.text('OBSERVACIONES', 20, y + 10);

    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(70, 70, 70);
    pdf.text('Gracias por confiar en nuestros servicios.', 20, y + 22);

    // Totales
    pdf.setFillColor(248, 250, 252);
    pdf.setDrawColor(210, 220, 230);
    pdf.roundedRect(116, y, 80, 42, 3, 3, 'FD');

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(45, 45, 45);
    pdf.text('Base imponible:', 122, y + 11);
    pdf.text(`${t.base.toFixed(2)} €`, 174, y + 11);

    pdf.text('IGIC:', 122, y + 21);
    pdf.text(`${t.igic.toFixed(2)} €`, 174, y + 21);

    pdf.setDrawColor(...azul);
    pdf.line(122, y + 27, 190, y + 27);

    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(...azul);
    pdf.setFontSize(17);
    pdf.text('TOTAL:', 122, y + 38);
    pdf.text(`${t.total.toFixed(2)} €`, 162, y + 38);

    // QR / huella solo factura emitida
    if (doc.tipo === 'factura' && doc.hashActual) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7);
      pdf.setTextColor(90, 90, 90);
      pdf.text(`Huella Veri*Factu: ${doc.hashActual}`, 14, 276, { maxWidth: 180 });
    }

    // Pie
    pdf.setFillColor(...azul);
    pdf.rect(0, 287, 210, 10, 'F');

    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.text(`${nombreEmpresa} · ${data.empresa.nif || ''}`, 12, 293);

    pdf.save(`${titulo}-${doc.numero}.pdf`);
  }

  function formatPdfDate(date: string) {
    if (!date) return '';
    const [y, m, d] = date.split('-');
    return `${d}/${m}/${y}`;
  }

  function enviarGmail(doc: Documento) {
    const cliente = data.clientes.find(c => c.id === doc.clienteId);
    const subject = encodeURIComponent(`${doc.tipo === 'factura' ? 'Factura' : 'Presupuesto'} ${doc.numero}`);
    const body = encodeURIComponent(`Hola,\n\nTe envío el ${doc.tipo} ${doc.numero}.\n\nTotal: ${totals(doc).total.toFixed(2)} €\n\n${data.empresa.emailConfig?.firma ?? data.empresa.nombre}`);
    const to = encodeURIComponent(cliente?.email ?? '');
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${subject}&body=${body}`, '_blank');
  }

  return <main>
    <aside><h1>Facturas JG</h1><p>IGIC 7% · Veri*Factu · copias</p><button onClick={() => nuevoDocumento('factura')}><Plus size={18}/> Nueva factura</button><button onClick={() => nuevoDocumento('presupuesto')}><Plus size={18}/> Nuevo presupuesto</button><nav><Nav tab={tab} id="empresa" setTab={setTab} icon={<Building2/>} text="Mi empresa"/><Nav tab={tab} id="clientes" setTab={setTab} icon={<Users/>} text="Clientes"/><Nav tab={tab} id="facturas" setTab={setTab} icon={<ReceiptText/>} text="Facturas"/><Nav tab={tab} id="presupuestos" setTab={setTab} icon={<FileText/>} text="Presupuestos"/><Nav tab={tab} id="verifactu" setTab={setTab} icon={<ShieldCheck/>} text="Veri*Factu"/><Nav tab={tab} id="copias" setTab={setTab} icon={<ArchiveRestore/>} text="Copias"/></nav></aside>
    <section className="content"><div className="cards"><Card title="Clientes" value={data.clientes.length}/><Card title="Facturas" value={data.documentos.filter(d=>d.tipo==='factura').length}/><Card title="Emitido" value={`${totalEmitido.toFixed(2)} €`}/></div>{status && <p className="ok">{status}</p>}{tab === 'empresa' && <EmpresaForm data={data} updateEmpresa={updateEmpresa} updateNumeracion={updateNumeracion} uploadLogo={uploadLogo}/>} {tab === 'clientes' && <ClientesPanel clientes={data.clientes} selected={selectedCliente} nuevoCliente={nuevoCliente} updateCliente={updateCliente} borrarCliente={borrarCliente} select={setSelectedClienteId} search={clienteSearch} setSearch={setClienteSearch}/>} {(tab === 'facturas' || tab === 'presupuestos') && <DocumentosPanel tipo={tab==='facturas'?'factura':'presupuesto'} data={data} docs={docs} selected={selectedDoc} select={setSelectedDocId} updateDoc={updateDoc} emitir={emitir} convertir={convertir} descargarPDF={descargarPDF} borrarDocumento={borrarDocumento} descargarXML={descargarXML} enviarGmail={enviarGmail} search={docSearch} setSearch={setDocSearch}/>} {tab === 'verifactu' && <VerifactuPanel data={data} persist={persist} descargarXML={descargarXML} enviarAEAT={enviarAEAT}/>} {tab === 'copias' && <CopiasPanel crearBackupAppData={crearBackupAppData} descargarBackupLocal={descargarBackupLocal} restaurarBackup={restaurarBackup}/>}</section>
  </main>;
}

function Nav({tab,id,setTab,icon,text}:{tab:Tab;id:Tab;setTab:(t:Tab)=>void;icon:React.ReactNode;text:string}) { return <a className={tab===id?'active':''} onClick={()=>setTab(id)}>{icon}{text}</a>; }
function Card({title,value}:{title:string;value:React.ReactNode}) { return <div className="card"><span>{title}</span><strong>{value}</strong></div>; }
function Field({label, value, onChange, type='text'}:{label:string; value:string|number; onChange:(v:string)=>void; type?:string}) { return <label><span>{label}</span><input type={type} value={value ?? ''} onChange={e=>onChange(e.target.value)}/></label>; }
function downloadText(filename:string, text:string, type:string) { const blob = new Blob([text], { type }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); }

function EmpresaForm({data, updateEmpresa, updateNumeracion, uploadLogo}:{data:AppData; updateEmpresa:(field:keyof AppData['empresa'], value:any)=>void; updateNumeracion:(field:keyof AppData['empresa']['numeracion'], value:any)=>void; uploadLogo:(file?:File)=>void}) {
  return <div className="panel"><h2>Mi empresa</h2><div className="toolbar"><label className="upload"><ImagePlus size={16}/> Subir logo<input hidden type="file" accept="image/png,image/jpeg" onChange={e=>uploadLogo(e.target.files?.[0])}/></label>{data.empresa.logo && <button className="danger" onClick={()=>updateEmpresa('logo','')}>Quitar logo</button>}</div>{data.empresa.logo && <div className="logo-preview"><img src={data.empresa.logo} alt="Logo de empresa"/><span>Este logo saldrá en facturas y presupuestos PDF.</span></div>}<div className="form-grid"><Field label="Nombre fiscal" value={data.empresa.nombre} onChange={v=>updateEmpresa('nombre', v)}/><Field label="NIF/CIF" value={data.empresa.nif} onChange={v=>updateEmpresa('nif', v)}/><Field label="Dirección" value={data.empresa.direccion} onChange={v=>updateEmpresa('direccion', v)}/><Field label="Código postal" value={data.empresa.codigoPostal} onChange={v=>updateEmpresa('codigoPostal', v)}/><Field label="Ciudad" value={data.empresa.ciudad} onChange={v=>updateEmpresa('ciudad', v)}/><Field label="Provincia" value={data.empresa.provincia} onChange={v=>updateEmpresa('provincia', v)}/><Field label="Teléfono" value={data.empresa.telefono} onChange={v=>updateEmpresa('telefono', v)}/><Field label="Email" value={data.empresa.email} onChange={v=>updateEmpresa('email', v)}/><label><span>Impuesto por defecto</span><select value={data.empresa.regimen} onChange={e=>updateEmpresa('regimen', e.target.value)}>{Object.entries(impuestos).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label><Field label="Gmail remitente" value={data.empresa.emailConfig?.gmail ?? ''} onChange={v=>updateEmpresa('emailConfig', {...data.empresa.emailConfig, gmail:v})}/></div><h3>Numeración</h3><div className="form-grid"><Field label="Prefijo facturas" value={data.empresa.numeracion.prefijoFactura} onChange={v=>updateNumeracion('prefijoFactura', v)}/><Field label="Siguiente factura" type="number" value={data.empresa.numeracion.siguienteFactura} onChange={v=>updateNumeracion('siguienteFactura', Number(v))}/><Field label="Prefijo presupuestos" value={data.empresa.numeracion.prefijoPresupuesto} onChange={v=>updateNumeracion('prefijoPresupuesto', v)}/><Field label="Siguiente presupuesto" type="number" value={data.empresa.numeracion.siguientePresupuesto} onChange={v=>updateNumeracion('siguientePresupuesto', Number(v))}/><Field label="Dígitos" type="number" value={data.empresa.numeracion.digitos} onChange={v=>updateNumeracion('digitos', Number(v))}/><label><span>Numeración manual</span><select value={String(data.empresa.numeracion.modoManual)} onChange={e=>updateNumeracion('modoManual', e.target.value==='true')}><option value="true">Permitir escribir número</option><option value="false">Automático</option></select></label></div><p className="ok"><Save size={16}/> Los cambios se guardan automáticamente.</p></div>;
}

function ClientesPanel({clientes, selected, nuevoCliente, updateCliente, borrarCliente, select, search, setSearch}:{clientes:Cliente[]; selected?:Cliente; nuevoCliente:()=>void; updateCliente:(id:string, field:keyof Cliente, value:string)=>void; borrarCliente:(id:string)=>void; select:(id:string)=>void; search:string; setSearch:(v:string)=>void}) {
  const q = search.trim().toLowerCase();
  const visibles = clientes.filter(c => !q || [c.nombre, c.nif, c.telefono, c.email, c.ciudad].filter(Boolean).some(v => String(v).toLowerCase().includes(q)));
  return <div className="grid"><div className="panel"><h2>Clientes</h2><div className="search"><Search size={16}/><input placeholder="Buscar cliente por nombre, CIF, email o teléfono" value={search} onChange={e=>setSearch(e.target.value)}/></div><button onClick={nuevoCliente}><Plus size={16}/> Nuevo cliente</button>{visibles.length===0 && <p className="muted">No hay clientes que coincidan.</p>}{visibles.map(c=><button className={`row ${selected?.id===c.id?'sel':''}`} key={c.id} onClick={()=>select(c.id)}><span>{c.nombre || 'Cliente sin nombre'}</span><b>{c.nif}</b></button>)}</div><div className="panel">{selected ? <><h2>Datos del cliente</h2><div className="form-grid"><Field label="Nombre" value={selected.nombre} onChange={v=>updateCliente(selected.id,'nombre',v)}/><Field label="CIF/NIF" value={selected.nif} onChange={v=>updateCliente(selected.id,'nif',v)}/><Field label="Dirección" value={selected.direccion} onChange={v=>updateCliente(selected.id,'direccion',v)}/><Field label="Código postal" value={selected.codigoPostal} onChange={v=>updateCliente(selected.id,'codigoPostal',v)}/><Field label="Ciudad" value={selected.ciudad} onChange={v=>updateCliente(selected.id,'ciudad',v)}/><Field label="Provincia" value={selected.provincia} onChange={v=>updateCliente(selected.id,'provincia',v)}/><Field label="Teléfono" value={selected.telefono} onChange={v=>updateCliente(selected.id,'telefono',v)}/><Field label="Email" value={selected.email} onChange={v=>updateCliente(selected.id,'email',v)}/></div><button className="danger" onClick={()=>borrarCliente(selected.id)}><Trash2 size={16}/> Eliminar cliente</button></> : <p className="muted">Selecciona o crea un cliente.</p>}</div></div>; }

function DocumentosPanel({tipo, data, docs, selected, select, updateDoc, emitir, convertir, descargarPDF, borrarDocumento, descargarXML, enviarGmail, search, setSearch}:{tipo:TipoDocumento; data:AppData; docs:Documento[]; selected?:Documento; select:(id:string)=>void; updateDoc:(doc:Documento)=>void; emitir:(doc:Documento)=>void; convertir:(doc:Documento)=>void; descargarPDF:(doc:Documento)=>void; borrarDocumento:(doc:Documento)=>void; descargarXML:(doc:Documento)=>void; enviarGmail:(doc:Documento)=>void; search:string; setSearch:(v:string)=>void}) { const title = tipo === 'factura' ? 'Facturas' : 'Presupuestos'; return <div className="grid"><div className="panel"><h2>{title}</h2><div className="search"><Search size={16}/><input placeholder={`Buscar ${title.toLowerCase()} por número, cliente, fecha o importe`} value={search} onChange={e=>setSearch(e.target.value)}/></div>{docs.length===0 && <p className="muted">No hay documentos que coincidan.</p>}{docs.map(d=>{ const cliente = data.clientes.find(c=>c.id===d.clienteId); return <button className={`row ${selected?.id===d.id?'sel':''}`} onClick={()=>select(d.id)} key={d.id}><span>{d.numero}<small>{cliente?.nombre ? ` · ${cliente.nombre}` : ''}</small></span><span>{d.estado}</span><b>{totals(d).total.toFixed(2)} €</b></button>})}</div><div className="panel invoice">{selected ? <EditorDocumento data={data} doc={selected} updateDoc={updateDoc} emitir={emitir} convertir={convertir} descargarPDF={descargarPDF} borrarDocumento={borrarDocumento} descargarXML={descargarXML} enviarGmail={enviarGmail}/> : <p className="muted">Selecciona o crea un documento.</p>}</div></div>; }

function EditorDocumento({data, doc, updateDoc, emitir, convertir, descargarPDF, borrarDocumento, descargarXML, enviarGmail}:{data:AppData; doc:Documento; updateDoc:(doc:Documento)=>void; emitir:(doc:Documento)=>void; convertir:(doc:Documento)=>void; descargarPDF:(doc:Documento)=>void; borrarDocumento:(doc:Documento)=>void; descargarXML:(doc:Documento)=>void; enviarGmail:(doc:Documento)=>void}) {
  const t = totals(doc); const set = (patch: Partial<Documento>) => updateDoc({ ...doc, ...patch }); const setLinea = (id:string, patch:Partial<LineaDocumento>) => set({ lineas: doc.lineas.map(l => l.id === id ? { ...l, ...patch } : l) }); const dup = duplicateNumber(data, doc);
  return <><div className="invoice-head"><div><h2>{doc.tipo === 'factura' ? 'Factura' : 'Presupuesto'} {doc.numero}</h2><p>{doc.estado}{doc.tipo==='factura' ? ` · Veri*Factu: ${doc.verifactuEstado ?? 'pendiente'}` : ''}</p>{dup && <p className="warn">Número duplicado. Cámbialo antes de emitir.</p>}</div><div className="actions"><button onClick={()=>descargarPDF(doc)}><FileDown size={16}/> PDF</button><button onClick={()=>enviarGmail(doc)}><Mail size={16}/> Gmail</button>{doc.tipo==='factura' && doc.estado==='borrador' && <button onClick={()=>emitir(doc)}><Send size={16}/> Emitir / Veri*Factu</button>}{doc.tipo==='factura' && <button onClick={()=>descargarXML(doc)}>XML</button>}{doc.tipo==='presupuesto' && <button onClick={()=>convertir(doc)}>Convertir a factura</button>}<button className="danger" onClick={()=>borrarDocumento(doc)}><Trash2 size={16}/> Borrar</button></div></div><div className="form-grid"><label><span>Cliente</span><select value={doc.clienteId} onChange={e=>set({clienteId:e.target.value})}><option value="">Sin cliente</option>{data.clientes.map(c=><option key={c.id} value={c.id}>{c.nombre || c.nif || 'Cliente sin nombre'}</option>)}</select></label><Field label="Número" value={doc.numero} onChange={v=>set({numero:v})}/><Field label="Fecha" type="date" value={doc.fecha} onChange={v=>set({fecha:v})}/></div><table><thead><tr><th>Concepto</th><th>Cant.</th><th>Precio</th><th>IGIC</th><th></th></tr></thead><tbody>{doc.lineas.map(l=><tr key={l.id}><td><input value={l.descripcion} onChange={e=>setLinea(l.id,{descripcion:e.target.value})}/></td><td><input type="number" value={l.cantidad} onChange={e=>setLinea(l.id,{cantidad:Number(e.target.value)})}/></td><td><input type="number" value={l.precio === 0 ? '' : l.precio} onChange={e=>setLinea(l.id,{precio:e.target.value === '' ? 0 : Number(e.target.value)})}/></td><td><select value={l.impuesto} onChange={e=>setLinea(l.id,{impuesto:e.target.value as TipoImpuesto})}>{Object.entries(impuestos).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></td><td><button className="icon" onClick={()=>set({lineas:doc.lineas.filter(x=>x.id!==l.id)})}><Trash2 size={15}/></button></td></tr>)}</tbody></table><button onClick={()=>set({lineas:[...doc.lineas, blankLinea(data.empresa.regimen)]})}><Plus size={16}/> Añadir línea</button><div className="bottom"><div>{doc.qr && <><QRCodeSVG value={doc.qr} size={132}/><p className="tiny">QR Veri*Factu</p></>}</div><div className="totals"><p>Base imponible: {t.base.toFixed(2)} €</p><p>IGIC: {t.igic.toFixed(2)} €</p><h3>Total: {t.total.toFixed(2)} €</h3>{doc.hashActual && <p className="hash">Huella: {doc.hashActual}</p>}</div></div></>;
}

function VerifactuPanel({data, persist, descargarXML, enviarAEAT}:{data:AppData; persist:(next:AppData)=>Promise<void>; descargarXML:(doc:Documento)=>void; enviarAEAT:(doc:Documento)=>Promise<Documento>}) {
  const [certs, setCerts] = useState<CertificadoWindows[]>([]); const [loading, setLoading] = useState(false); const facturas = data.documentos.filter(d => d.tipo === 'factura'); const generadas = facturas.filter(d => d.verifactuEstado === 'generado' || d.hashActual);
  async function cargarCerts() { setLoading(true); try { const list = await invoke<CertificadoWindows[]>('list_windows_certificates'); setCerts(list); } catch (e) { alert(`No se pudieron leer certificados: ${e}`); } finally { setLoading(false); } }
  function seleccionarCert(thumbprint:string) { const c = certs.find(x => x.thumbprint === thumbprint); if (!c) return; persist({ ...data, empresa: { ...data.empresa, certificadoNombre: c.subject, certificadoThumbprint: c.thumbprint, certificadoCaduca: c.not_after } }); }
  return <div className="panel"><h2>Veri*Factu</h2><p className="muted">Integrado en el programa: al emitir una factura se genera huella, QR y XML, y se guarda el registro en AppData/FacturasJG/verifactu. El botón Enviar AEAT usa la configuración de modo, endpoint y certificado.</p><div className="toolbar"><button onClick={cargarCerts}><RefreshCw size={16}/> {loading ? 'Leyendo...' : 'Leer certificados Windows'}</button></div><div className="form-grid"><label><span>Modo Veri*Factu</span><select value={data.empresa.verifactuModo ?? 'pendiente'} onChange={e=>persist({...data, empresa:{...data.empresa, verifactuModo:e.target.value as any}})}><option value="pendiente">Solo generar XML</option><option value="pruebas">Pruebas AEAT</option><option value="produccion">Producción AEAT</option></select></label><label><span>Autoenviar al emitir</span><select value={String(data.empresa.verifactuAutoEnviar ?? false)} onChange={e=>persist({...data, empresa:{...data.empresa, verifactuAutoEnviar:e.target.value==='true'}})}><option value="false">No, solo generar</option><option value="true">Sí, enviar</option></select></label><label><span>Endpoint pruebas AEAT</span><input value={data.empresa.verifactuEndpointPruebas ?? ''} onChange={e=>persist({...data, empresa:{...data.empresa, verifactuEndpointPruebas:e.target.value}})} placeholder="Pegar URL WSDL/SOAP pruebas"/></label><label><span>Endpoint producción AEAT</span><input value={data.empresa.verifactuEndpointProduccion ?? ''} onChange={e=>persist({...data, empresa:{...data.empresa, verifactuEndpointProduccion:e.target.value}})} placeholder="Pegar URL WSDL/SOAP producción"/></label><label><span>Certificado instalado</span><select value={data.empresa.certificadoThumbprint ?? ''} onChange={e=>seleccionarCert(e.target.value)}><option value="">Seleccionar certificado</option>{certs.map(c=><option key={c.thumbprint} value={c.thumbprint}>{c.subject} · caduca {c.not_after}</option>)}</select></label></div>{data.empresa.certificadoNombre && <p className="ok">Certificado seleccionado: {data.empresa.certificadoNombre}<br/>Huella: {data.empresa.certificadoThumbprint}<br/>Caduca: {data.empresa.certificadoCaduca}</p>}<div className="cards mini"><Card title="Facturas" value={facturas.length}/><Card title="Registros generados" value={generadas.length}/><Card title="Pendientes" value={facturas.length - generadas.length}/></div><h3>Registros</h3>{facturas.map(f => <div className="row plain" key={f.id}><span>{f.numero} · {f.estado}{f.verifactuCsv ? ` · CSV ${f.verifactuCsv}` : ''}</span><span>{f.verifactuEstado ?? 'pendiente'}</span><button onClick={()=>descargarXML(f)}>XML</button><button onClick={()=>enviarAEAT(f)}>Enviar AEAT</button>{f.verifactuRespuesta && <small>{f.verifactuRespuesta}</small>}</div>)}</div>;
}

function CopiasPanel({crearBackupAppData, descargarBackupLocal, restaurarBackup}:{crearBackupAppData:()=>void; descargarBackupLocal:()=>void; restaurarBackup:(file?:File)=>void}) { return <div className="panel"><h2>Copias de seguridad</h2><p className="muted">Usa estas opciones para cambiar de equipo o reinstalar Windows sin perder empresa, clientes, facturas, presupuestos, logo y configuración.</p><div className="toolbar"><button onClick={crearBackupAppData}><Save size={16}/> Crear copia en AppData</button><button onClick={descargarBackupLocal}><Download size={16}/> Descargar copia JSON</button><label className="upload"><Upload size={16}/> Restaurar copia<input hidden type="file" accept="application/json,.json" onChange={e=>restaurarBackup(e.target.files?.[0])}/></label></div><p className="muted">Ruta local: AppData/Roaming/FacturasJG/data.json y carpeta backups.</p></div>; }

createRoot(document.getElementById('root')!).render(<App />);
