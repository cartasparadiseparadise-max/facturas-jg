# Instalación y uso

## 1. Instalar dependencias

```bash
npm install
```

## 2. Ejecutar en modo desarrollo

```bash
npm run app:dev
```

## 3. Compilar instalador

```bash
npm run app:build
```

## 4. Usar Veri*Factu dentro del programa

1. Abre la pestaña **Veri*Factu**.
2. Pulsa **Leer certificados Windows**.
3. Selecciona tu certificado digital.
4. Deja el modo en **Solo generar XML** para probar.
5. Emite una factura desde **Facturas**.
6. El programa genera la huella, el QR y el XML automáticamente.
7. El XML queda guardado en:

```text
AppData/Roaming/FacturasJG/verifactu
```

## 5. Envío AEAT

La pantalla permite configurar endpoint de pruebas y producción. Para uso real hay que pegar los endpoints oficiales vigentes y validar la firma SOAP/XAdES contra AEAT.
