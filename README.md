# Eco-Field API 服務

這是 **ECO-FIELD 生態調查氣象儀表板** 的後端服務。
本專案基於 Node.js 與 Express 建構，負責串接中央氣象署 (CWA) 開放資料，並提供經緯度定位、天文計算與資安防護功能。

## 功能特色

- **資料介接**：串接 CWA `F-D0047-091` (臺灣各縣市未來1週天氣預報) 資料集。
- **天文運算**：內建 `SunCalc` 演算法，根據座標即時計算日出/日落時間 (強制轉換為 Asia/Taipei 時區)。
- **智慧快取**：實作 10 分鐘記憶體快取 (In-Memory Cache)，避免超過氣象署 API 呼叫上限。
- **資安防護**：
    - **CORS 白名單**：限制僅允許特定前端網域呼叫。
    - **Rate Limiting**：限制單一 IP 請求頻率，防止 DDoS 或濫用。
    - **Helmet**：HTTP 標頭安全強化。

## 安裝步驟

### 1. 安裝相依套件

```bash
npm install
```

### 2. 設定環境變數

在專案根目錄建立 `.env` 檔案：

```bash
touch .env
```

編輯 `.env` 檔案，填入你的 CWA API Key：

```env
CWA_API_KEY=your_api_key_here
PORT=3000
NODE_ENV=development
```

### 3. 設定 CORS 白名單 (server.js)
請在 server.js 中修改 whitelist 陣列，加入您的前端網址：
const whitelist = [
  'http://localhost:3000',
  '[https://您的帳號.github.io](https://您的帳號.github.io)' // GitHub Pages 前端網址
];

## 啟動服務

### 開發模式（自動重啟）

```bash
npm run dev
```

### 正式模式

```bash
npm start
```

伺服器會在 `http://localhost:3000` 啟動

## API 文件

### 取得一週天氣預報

```
GET /api/weather/week
```

回應：

```json
{
  "success": true,
  "data": {
    "city": "臺北市",
    "forecasts": [
        {
            "startTime": "2023-11-30T18:00:00+08:00",
            "weather": "陰短暫雨",
            "rainProb": "30",
            "temp": "23",
            "windSpeed": "3"
        }
    ],
    "astro": [
        { "date": "2023-11-30", "sunrise": "06:20", "sunset": "17:05" }
    ]
  }
}
```

### 2. 健康檢查

```
GET /api/health
```

回應：

```json
{
  "status": "OK",
  "timestamp": "2025-09-30T12:00:00.000Z"
}
```
## 專案結構

```
CwaWeather-backend/
├── server.js              # Express 伺服器主檔案（包含路由與控制器邏輯）
├── .env                   # 環境變數（不納入版控）
├── .gitignore            # Git 忽略檔案
├── package.json          # 專案設定與相依套件
├── package-lock.json     # 套件版本鎖定檔案
└── README.md            # 說明文件
```

## 使用的套件

- **express**: Web 框架
- **axios**: HTTP 客戶端
- **dotenv**: 環境變數管理
- **cors**: 跨域資源共享
- **nodemon**: 開發時自動重啟（開發環境）

## 注意事項

1. 請確保已申請 CWA API Key 並正確設定在 `.env` 檔案中
2. API Key 有每日呼叫次數限制，請參考 CWA 平台說明
3. 不要將 `.env` 檔案上傳到 Git 版本控制（已包含在 `.gitignore` 中）
4. 所有路由與業務邏輯都在 `server.js` 檔案中，適合小型專案使用

## 錯誤處理

API 會回傳適當的 HTTP 狀態碼和錯誤訊息：

- `200`: 成功
- `404`: 找不到資料
- `500`: 伺服器錯誤

錯誤回應格式：

```json
{
  "error": "錯誤類型",
  "message": "錯誤訊息"
}
```

## 授權

MIT