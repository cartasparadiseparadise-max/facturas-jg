# Facturas JG V6

Aplicación Windows/macOS con enfoque Canarias:

- IGIC 7%, 3%, 0% y Exento
- Empresa editable y logo
- Clientes editables
- Facturas y presupuestos editables
- Numeración personalizada: por defecto `26F00001` y `26P00001`
- Campo manual para escribir el número exacto de factura/presupuesto
- Descargar PDF
- Abrir Gmail con asunto y cuerpo preparado
- Borrar facturas/presupuestos/clientes
- Copias de seguridad y restauración JSON
- Datos persistentes en AppData/Roaming/FacturasJG/data.json
- Pantalla Veri*Factu con lectura de certificados instalados en Windows
- Generación local de XML, huella y QR

## Compilar en Windows

```powershell
cd C:\Facturas JG
npm install
npm install -D @tauri-apps/cli
npm run app:build
```

El ejecutable queda en:

```text
C:\Facturas JG\src-tauri\target\release\facturas-jg-desktop.exe
```

## Aviso Veri*Factu

Esta V6 añade el selector real de certificados Windows y genera XML/huella/QR. El envío final a AEAT debe validarse con los esquemas y endpoints oficiales, firma XAdES y entorno de pruebas antes de utilizarse fiscalmente en producción.

## V5 añadidos

- Buscador de clientes por nombre, CIF/NIF, email, teléfono y ciudad.
- Buscador de facturas y presupuestos por número, cliente, fecha, estado o importe.
- Selector de cliente dentro de cada factura y presupuesto.
- Logo de empresa en la ficha de empresa y en PDFs de facturas/presupuestos.
- Copias de seguridad: crear copia en AppData, descargar JSON y restaurar JSON.


## V6 corregido

- Nombre de programa cambiado a **Facturas JG**.
- El precio ya no deja un 0 delante al escribir.
- Logo reforzado en PDF de facturas y presupuestos.
- Carpeta de datos: `AppData/Roaming/FacturasJG`.
