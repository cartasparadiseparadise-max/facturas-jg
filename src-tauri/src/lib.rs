use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, process::Command};

fn app_dir() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or("No se pudo localizar el directorio de datos")?;
    let dir = base.join("FacturasJG");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn data_file() -> Result<PathBuf, String> {
    Ok(app_dir()?.join("data.json"))
}

#[tauri::command]
fn save_data(payload: String) -> Result<(), String> {
    fs::write(data_file()?, payload).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_data() -> Result<Option<String>, String> {
    let path = data_file()?;
    if path.exists() {
        fs::read_to_string(path).map(Some).map_err(|e| e.to_string())
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn create_backup() -> Result<String, String> {
    let source = data_file()?;
    if !source.exists() {
        return Err("Todavía no hay datos guardados para crear copia".into());
    }
    let backups = app_dir()?.join("backups");
    fs::create_dir_all(&backups).map_err(|e| e.to_string())?;
    let stamp = chrono_like_stamp();
    let dest = backups.join(format!("facturas-jg-backup-{}.json", stamp));
    fs::copy(&source, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

fn chrono_like_stamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    secs.to_string()
}

#[derive(Serialize)]
struct CertificadoWindows {
    subject: String,
    issuer: String,
    thumbprint: String,
    not_after: String,
    has_private_key: bool,
}

#[tauri::command]
fn list_windows_certificates() -> Result<Vec<CertificadoWindows>, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Ok(Vec::new());
    }

    #[cfg(target_os = "windows")]
    {
        let script = r#"
$certs = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.HasPrivateKey -eq $true } | ForEach-Object {
  [PSCustomObject]@{
    subject = $_.Subject
    issuer = $_.Issuer
    thumbprint = $_.Thumbprint
    not_after = $_.NotAfter.ToString('yyyy-MM-dd')
    has_private_key = $_.HasPrivateKey
  }
}
$certs | ConvertTo-Json -Depth 3
"#;

        let output = Command::new("powershell")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script])
            .output()
            .map_err(|e| format!("No se pudo ejecutar PowerShell: {}", e))?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if stdout.is_empty() {
            return Ok(Vec::new());
        }

        let value: serde_json::Value = serde_json::from_str(&stdout).map_err(|e| format!("No se pudieron leer los certificados: {}", e))?;
        let arr = if value.is_array() { value.as_array().cloned().unwrap_or_default() } else { vec![value] };
        let mut certs = Vec::new();
        for item in arr {
            certs.push(CertificadoWindows {
                subject: item.get("subject").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                issuer: item.get("issuer").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                thumbprint: item.get("thumbprint").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                not_after: item.get("not_after").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                has_private_key: item.get("has_private_key").and_then(|v| v.as_bool()).unwrap_or(false),
            });
        }
        Ok(certs)
    }
}

#[derive(Deserialize)]
struct VerifactuSendRequest {
    numero: String,
    xml: String,
    endpoint: Option<String>,
    modo: Option<String>,
    certificado_thumbprint: Option<String>,
}

#[derive(Serialize)]
struct VerifactuSendResponse {
    estado: String,
    csv: String,
    mensaje: String,
    ruta_xml: String,
    enviado_en: String,
}

#[tauri::command]
fn save_verifactu_xml(numero: String, xml: String) -> Result<String, String> {
    let dir = app_dir()?.join("verifactu");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe = numero.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "-");
    let path = dir.join(format!("verifactu-{}.xml", safe));
    fs::write(&path, xml).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn send_verifactu_record(req: VerifactuSendRequest) -> Result<VerifactuSendResponse, String> {
    let ruta = save_verifactu_xml(req.numero.clone(), req.xml.clone())?;
    let stamp = chrono_like_stamp();
    let endpoint = req.endpoint.unwrap_or_default();
    let modo = req.modo.unwrap_or_else(|| "pruebas".into());

    if endpoint.trim().is_empty() || modo == "pendiente" {
        return Ok(VerifactuSendResponse {
            estado: "generado".into(),
            csv: format!("SIM-{}", stamp),
            mensaje: "XML guardado. Envío AEAT no ejecutado porque falta endpoint oficial o el modo está pendiente.".into(),
            ruta_xml: ruta,
            enviado_en: stamp,
        });
    }

    // Punto de integración real: aquí se debe firmar el XML según las especificaciones vigentes de AEAT
    // y enviar el sobre SOAP al endpoint configurado usando el certificado indicado. El XML queda
    // guardado siempre para trazabilidad y revisión.
    Ok(VerifactuSendResponse {
        estado: "firmado".into(),
        csv: format!("PENDIENTE-AEAT-{}", stamp),
        mensaje: format!("Preparado para envío a {} con certificado {}. Falta activar firma SOAP/XAdES validada contra AEAT.", endpoint, req.certificado_thumbprint.unwrap_or_default()),
        ruta_xml: ruta,
        enviado_en: stamp,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![save_data, load_data, create_backup, list_windows_certificates, save_verifactu_xml, send_verifactu_record])
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}
