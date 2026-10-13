# 獨立安裝與維運

本專案不提供指向任何既有公司的部署腳本。每個客戶應使用自己的目錄、環境檔、資料库、附件儲存、主機及整合帳號。不可複製其他安裝的 `.env` 或資料目錄。

## 本機開發

安裝 Node.js 24 和 pnpm 11 後，執行 README 的安裝步驟。`pnpm run setup` 保留既有 `.env`；新檔會產生隨機密碼與金鑰，PostgreSQL 限 loopback 且使用獨立 `55434` 連接埠。

Windows PowerShell 可在執行 `pnpm admin` 的終端機設定：

```powershell
$env:ADMIN_EMAIL = 'admin@example.com'
$env:ADMIN_NAME = '管理員'
$env:WORKSPACE_NAME = '我的公司'
$secret = Read-Host '首次管理員密碼（至少 12 字元）' -AsSecureString
$env:ADMIN_PASSWORD = [System.Net.NetworkCredential]::new('', $secret).Password
pnpm admin
Remove-Item Env:ADMIN_PASSWORD
```

Linux/macOS 可使用 `read -s` 讀取暫時的 `ADMIN_PASSWORD`，匯出供管理指令使用，結束後 `unset ADMIN_PASSWORD`。不要把密碼寫入命令歷史或 Git。

## Docker Compose

下列初始化指令需要 Node.js 24、pnpm 11 及 Docker Compose。先完成 `pnpm install --frozen-lockfile`；`setup:compose` 會建立獨立的 `.env.compose`，若檔案已存在則拒絕覆寫。

```sh
pnpm run setup:compose
docker compose --env-file .env.compose up --build -d
docker compose --env-file .env.compose ps
```

預設專案名稱為 `syntherisk-erp`，專用具名 volumes；主機只暴露 `127.0.0.1:3030`，資料庫不對外發布。初始化會將隨機的安裝專屬映像標籤寫入 `.env.compose` 的 `ERP_IMAGE`，後續建置沿用該標籤。多個客戶使用不同目錄、`--project-name`、`ERP_PORT` 及 `ERP_IMAGE`，避免共用映像或 volumes。若已有環境檔缺少 `ERP_IMAGE`，請自行補入未被其他安裝使用的映像名稱；Compose 會拒絕在缺少此值時啟動。不要複製其他安裝的環境檔，也不要使用原公司 Compose 專案名或既有 volumes。

管理員初始設定使用上方環境變數，再執行：

```sh
docker compose --env-file .env.compose exec -e ADMIN_EMAIL -e ADMIN_NAME -e ADMIN_PASSWORD -e WORKSPACE_NAME app node --import tsx scripts/admin.ts
```

對外提供服務前，設定客戶自己的 HTTPS 反向代理與 `APP_URL`。整合登入需要設定自己已驗證的 `GOOGLE_WORKSPACE_DOMAIN`，預設為關閉。郵件重設密碼需要客戶 SMTP；使用 TLS。沒有付款服務、雲端金鑰或外部帳號時仍可使用本機核心功能。

## 相應原始碼

頁尾提供原始碼及授權連結。若修改後部署，建置時設定 `NEXT_PUBLIC_SOURCE_URL` 指向該部署版本的完整原始碼；包含必要建置與安裝程式，但不包含私人 `.env` 或客戶資料。每次交付保留對應 commit/tag。

## 備份與更新

使用 `pnpm backup` 產生資料庫、受管理附件及雜湊清單，另行安全備份環境金鑰；先閱讀 `scripts/backup.ts` 了解輸出及需求。把備份存於受控、加密的位置，執行還原演練。不要將備份提交到公開倉庫。

更新前建立備份與還原點，在獨立測試資料庫先套用 migrations 並驗證主要流程。更新後檢查 `/api/health`、登入、任務、打卡、薪資讀取及 worker。資料庫 migration 可能不可直接倒退；回復應使用已演練的備份還原流程，而非任意切換程式版本。

## 驗證範圍

自動測試、型別檢查、建置和本機瀏覽器驗收只能證明相應版本與測試情境。各客戶的薪資約定、主機安全、備份可恢復性、外部登入及郵件須在自己的環境驗收。本專案不會替未設定的外部服務宣稱驗證完成。
