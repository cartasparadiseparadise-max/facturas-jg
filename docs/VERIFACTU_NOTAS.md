# Notas de integración Veri*Factu

La AEAT publica en su sede la información técnica de SIF/Veri*Factu, incluyendo diseños de registro, WSDL, esquemas, validaciones, cálculo de huella/hash y firma electrónica.

Esta versión implementa:
- Registro fiscal local por factura.
- Encadenamiento por `hash_anterior` y `hash_actual`.
- Canonicalización estable de campos clave.
- QR preliminar para consulta/verificación.

Pendiente para producción:
1. Adaptar XML final a los esquemas oficiales vigentes.
2. Implementar firma electrónica según especificación AEAT.
3. Integrar certificado FNMT/PKCS#12.
4. Consumir servicios SOAP/WSDL de remisión.
5. Gestionar errores, reintentos, estados y trazabilidad.
6. Declaración responsable del software.

No usar en producción fiscal sin validación jurídica/técnica.

## Cambios de integración añadidos

Esta versión integra Veri*Factu dentro del programa:

- Al emitir una factura se genera la huella, el QR y el XML.
- El XML se guarda automáticamente en `AppData/Roaming/FacturasJG/verifactu`.
- En la pestaña Veri*Factu se puede elegir certificado Windows, modo, endpoint de pruebas/producción y autoenvío.
- El botón `Enviar AEAT` llama al comando Tauri `send_verifactu_record`.
- Si no hay endpoint o el modo está pendiente, funciona como modo seguro: guarda XML y deja estado generado.

Importante: el envío fiscal definitivo exige pegar los endpoints oficiales vigentes de AEAT y completar/validar la firma SOAP/XAdES contra los WSDL/XSD publicados por la AEAT. No debe declararse como software certificado sin dicha validación.
