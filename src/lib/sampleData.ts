import type { AppData } from './types';

export const sampleData: AppData = {
  empresa: {
    nombre: '',
    nif: '',
    direccion: '',
    codigoPostal: '',
    ciudad: '',
    provincia: 'Las Palmas / Santa Cruz de Tenerife',
    telefono: '',
    email: '',
    regimen: 'IGIC_7',
    verifactuModo: 'pendiente',
    numeracion: {
      prefijoFactura: '26F',
      prefijoPresupuesto: '26P',
      siguienteFactura: 1,
      siguientePresupuesto: 1,
      digitos: 5,
      modoManual: true
    }
  },
  clientes: [],
  documentos: []
};
