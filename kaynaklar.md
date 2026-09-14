# Aethelion — Resmi Hesap, Giriş ve Altyapı Bilgileri (Kalıcı Kayıt)

Bu belge, Aethelion projesine ait tüm sunucu, bulut sağlayıcı, API ve yayın erişim kimlik bilgilerini içerir. **Asla silinmemelidir.**

---

## 1. Oracle Cloud Web Konsolu Giriş Bilgileri

* **Giriş Adresi:** [cloud.oracle.com](https://cloud.oracle.com)
* **Cloud Account Name (Tenancy Adı):** `aethelondev`
* **Kullanıcı Adı / E-posta:** `aethelondev@gmail.com`
* **Hesap Şifresi:**
  ```text
  kX9#vQ7$mP2!wL4@zR8*
  ```
* **Ana Bölge (Home Region):** `eu-frankfurt-1` (Almanya - Frankfurt)
* **Tenancy OCID:** `ocid1.tenancy.oc1..aaaaaaaafhjo4dtjkpeoa2pcsyesj5fevcguvmjnw3zr6faq7xl2jebyapva`

---

## 2. Oracle Cloud VPS (Sanal Sunucu & SSH) Bilgileri

* **Sunucu Adı (Display Name):** `lightning-server`
* **Makine Tipi (Shape):** `VM.Standard.A1.Flex` (4 OCPU ARM, 24 GB RAM, 45 GB Disk — Always Free)
* **Statik Genel IP (Public IP):** `130.61.53.100`
* **Kullanıcı Adı:** `ubuntu`
* **SSH Anahtar Dosyası (Proje Kök Dizini):** [`ssh-key-2026-09-10.key`](file:///c:/Users/Korhan/Desktop/AG%20Korhan/Lightning/ssh-key-2026-09-10.key)
* **Doğrudan Terminal Bağlantı Komutu:**
  ```bash
  ssh -i "ssh-key-2026-09-10.key" -o StrictHostKeyChecking=no ubuntu@130.61.53.100
  ```
* **Sunucu Proje Dizin Yolu:** `/home/ubuntu/lightning-globe`
* **Sunucudaki PM2 Servisleri:**
  - `PM2 ID 0` (`lightning-vite`): Port 3000 üzerinde çalışır, Nginx ile Port 80 arkasında sunulur.
  - `PM2 ID 1` (`kick-chat-bridge`): Canlı yayın etkileşim köprüsü.
  - `Xvfb :99` + `Chromium Kiosk`: Arka planda 1080p canlı küreyi render eder.
* **Merkezi 24 Saatlik Veri Arşivi:** `/home/ubuntu/lightning-globe/.cache/lightning_24h.json`

---

## 3. Canlı Yayın Platformları & Akış Anahtarları

* **Resmi İletişim E-postası:** `aethelondev@gmail.com`
* **Kick Kanalı:** [kick.com/aethelion](https://kick.com/aethelion) (veya `@AethelionLive`)
* **Kick Canlı Yayın Anahtarı (Stream Key):**
  ```text
  sk_us-west-2_UXPHD15MmntC_fidkxCfWIkGrTA1gU1pAftvvaay94p
  ```
* **YouTube Kanalı:** Aethelion - Earth Lightning Live (@AethelionDev)

---

## 4. Hava Durumu & Uydu API Anahtarları

* **EUMETSAT Data Store (Avrupa & Afrika MTG-LI Uydusu):**
  - **Consumer Key:** `LebV6hDdJa4UPd8wdvNVLN3SO6Aa`
  - **Consumer Secret:** `q14jrHpVaDazmLgoHwIviEOlM9Ia`
* **NOAA GOES-16 & GOES-18 (Amerika & Pasifik GLM Uyduları):**
  - AWS S3 Public Registry (Açık Veri Havuzu, kimlik doğrulaması gerektirmez).
* **Blitzortung (Küresel RF Yer İstasyonları):**
  - Gerçek zamanlı WebSocket akışı.

---

## 5. Kritik Yerel Komutlar

* **Canlı Sistemi Tek Tıkla Başlatma:** `CANLI_SIMSEK_BASLAT.bat`
* **Manuel Yerel Dev Sunucusu:** `npx vite --port 3005`
* **Sunucudaki 24 Saatlik Veriyi Yerelle Eşitleme:** `npm run sync:vps`
* **Birim Testleri (109 Test):** `npm test`
* **Üretim Derlemesi:** `npm run build`
