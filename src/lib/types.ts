export type TipoImpuesto = 'IGIC_7' | 'IGIC_3' | 'IGIC_0' | 'EXENTO';
export type VerifactuModo = 'pendiente' | 'pruebas' | 'produccion';
export type VerifactuEstado = 'pendiente' | 'generado' | 'firmado' | 'enviado' | 'aceptado' | 'rechazado' | 'error';

export interface NumeracionConfig {
  prefijoFactura: string;
  prefijoPresupuesto: string;
  siguienteFactura: number;
  siguientePresupuesto: number;
  digitos: number;
  modoManual: boolean;
}

export interface EmailConfig {
  gmail?: string;
  firma?: string;
}

export interface Empresa {
  nombre: string;
  nif: string;
  direccion: string;
  codigoPostal: string;
  ciudad: string;
  provincia: string;
  telefono: string;
  email: string;
  regimen: TipoImpuesto;
  logo?: string;
  verifactuModo?: VerifactuModo;
  certificadoNombre?: string;
  certificadoThumbprint?: string;
  certificadoCaduca?: string;
  verifactuEndpointPruebas?: string;
  verifactuEndpointProduccion?: string;
  verifactuAutoEnviar?: boolean;
  numeracion: NumeracionConfig;
  emailConfig?: EmailConfig;
}

export interface Cliente {
  id: string;
  nombre: string;
  nif: string;
  direccion: string;
  codigoPostal: string;
  ciudad: string;
  provincia: string;
  telefono: string;
  email: string;
}

export interface LineaDocumento {
  id: string;
  descripcion: string;
  cantidad: number;
  precio: number;
  impuesto: TipoImpuesto;
}

export type EstadoDocumento = 'borrador' | 'emitida' | 'aceptado' | 'rechazado' | 'anulada';
export type TipoDocumento = 'factura' | 'presupuesto';

export interface Documento {
  id: string;
  tipo: TipoDocumento;
  numero: string;
  clienteId: string;
  fecha: string;
  estado: EstadoDocumento;
  lineas: LineaDocumento[];
  notas?: string;
  hashAnterior?: string;
  hashActual?: string;
  qr?: string;
  verifactuEstado?: VerifactuEstado;
  verifactuXml?: string;
  verifactuRespuesta?: string;
  verifactuCsv?: string;
  verifactuUltimoEnvio?: string;
  enviadoEmail?: string;
}

export interface CertificadoWindows {
  subject: string;
  issuer: string;
  thumbprint: string;
  not_after: string;
  has_private_key: boolean;
}

export interface AppData {
  empresa: Empresa;
  clientes: Cliente[];
  documentos: Documento[];
}
