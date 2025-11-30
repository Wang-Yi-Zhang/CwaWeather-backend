require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const SunCalc = require("suncalc");

const app = express();
const PORT = process.env.PORT || 3000;
const CWA_API_KEY = process.env.CWA_API_KEY;

// === 1. 資安設定 ===
app.use(helmet()); // 設定 HTTP 安全標頭
// app.use(cors());   // 實際部屬建議設定 origin 白名單: { origin: 'https://your-domain.com' }

// === CORS 白名單設定 ===
const whitelist = [
  'http://localhost:3000',      // 本機開發環境
  'http://127.0.0.1:5500',      // 如果您用 VSCode Live Server
  'https://cwa-weather-a4.zeabur.app', // ★重要：請換成您實際部署在 Zeabur 的網址
  'https://wang-yi-zhang.github.io'
];

const corsOptions = {
  origin: function (origin, callback) {
    // !origin 表示沒有來源標頭的請求 (例如 Postman 或 Server-to-Server)，通常允許通過
    if (!origin || whitelist.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log("被 CORS 阻擋的來源:", origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST'], // 限制只能使用 GET 和 POST 方法
  allowedHeaders: ['Content-Type', 'Authorization'] // 限制允許的標頭
};

app.use(cors(corsOptions));

// 速率限制: 15分鐘內每 IP 只能呼叫 100 次
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100,
  message: { error: "請求過於頻繁，請稍後再試" }
});
app.use("/api/", limiter);

app.use(express.json());

// === 2. 靜態資料與工具函數 ===

// 簡易版地理中心點 (用於將 GPS 轉換為縣市)
const COUNTIES = [
  { name: "臺北市", lat: 25.032969, lon: 121.565418 },
  { name: "新北市", lat: 25.016982, lon: 121.462786 },
  { name: "基隆市", lat: 25.127603, lon: 121.739183 },
  { name: "桃園市", lat: 24.993628, lon: 121.300979 },
  { name: "新竹縣", lat: 24.838722, lon: 121.017724 },
  { name: "新竹市", lat: 24.813829, lon: 120.967480 },
  { name: "苗栗縣", lat: 24.560664, lon: 120.821428 },
  { name: "臺中市", lat: 24.147736, lon: 120.673648 },
  { name: "彰化縣", lat: 24.051796, lon: 120.516135 },
  { name: "南投縣", lat: 23.960998, lon: 120.971864 },
  { name: "雲林縣", lat: 23.709203, lon: 120.431337 },
  { name: "嘉義縣", lat: 23.451843, lon: 120.255461 },
  { name: "嘉義市", lat: 23.480047, lon: 120.449111 },
  { name: "臺南市", lat: 22.999728, lon: 120.227028 },
  { name: "高雄市", lat: 22.627278, lon: 120.301435 },
  { name: "屏東縣", lat: 22.551975, lon: 120.548759 },
  { name: "宜蘭縣", lat: 24.702107, lon: 121.737750 },
  { name: "花蓮縣", lat: 23.987158, lon: 121.601571 },
  { name: "臺東縣", lat: 22.761319, lon: 121.143126 },
  { name: "澎湖縣", lat: 23.571505, lon: 119.579315 },
  { name: "金門縣", lat: 24.440300, lon: 118.323254 },
  { name: "連江縣", lat: 26.158031, lon: 119.951486 }
];

// 計算兩點距離 (Haversine Formula)
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  const R = 6371; 
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon/2) * Math.sin(dLon/2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return R * c;
}

function deg2rad(deg) {
  return deg * (Math.PI/180);
}

// 簡單記憶體快取 (Simple In-Memory Cache)
const cache = {
  data: {}, // { "臺北市": { timestamp: 123456, data: {...} } }
  duration: 10 * 60 * 1000 // 10 分鐘
};

// === 3. 核心 API ===

app.get("/api/weather/week", async (req, res) => {
  try {
    let { city, lat, lon } = req.query;
    let targetCity = city;
    let targetLat = 0, targetLon = 0;

    // A. 定位邏輯
    if (lat && lon) {
      let minDistance = Infinity;
      let closestCity = null;
      
      COUNTIES.forEach(c => {
        const dist = getDistanceFromLatLonInKm(lat, lon, c.lat, c.lon);
        if (dist < minDistance) {
          minDistance = dist;
          closestCity = c;
        }
      });
      
      if (closestCity) {
        targetCity = closestCity.name;
        targetLat = closestCity.lat;
        targetLon = closestCity.lon;
      }
    } else if (city) {
        const cObj = COUNTIES.find(c => c.name === city);
        if(cObj) {
            targetLat = cObj.lat;
            targetLon = cObj.lon;
        }
    }

    if (!targetCity) {
      return res.status(400).json({ error: "請提供縣市名稱或經緯度" });
    }

    // B. 檢查快取
    const now = Date.now();
    if (cache.data[targetCity] && (now - cache.data[targetCity].timestamp < cache.duration)) {
      console.log(`[Cache Hit] ${targetCity}`);
      return res.json(cache.data[targetCity].data);
    }

    // C. 呼叫 CWA API (F-D0047-091 台灣各縣市未來1週逐12小時預報)
    // 為了獲取更細的資訊，我們調用「未來1週」但包含較多元素的資料集
    const apiUrl = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-091";
    const response = await axios.get(apiUrl, {
      params: {
        Authorization: CWA_API_KEY,
        locationName: targetCity,
        elementName: "Wx,PoP12h,T,RH,WS", // 天氣, 降雨機率, 溫度, 相對濕度, 風速
        sort: "time"
      }
    });

    const locationData = response.data.records.locations[0].location[0];
    if (!locationData) throw new Error("API 回傳無此地點資料");

    // D. 資料處理與格式化
    // CWA 的資料結構是 Element -> Time[]，我們需要轉置為 Time -> Elements
    const rawElements = locationData.weatherElement;
    
    // 整理天氣數據
    // 我們以第一個元素(Wx)的時間軸為基準
    const timeSlots = rawElements.find(e => e.elementName === "Wx").time;
    
    const formattedForecasts = timeSlots.map((slot, index) => {
        const startTime = new Date(slot.startTime);
        
        // 取得該時段對應的各項數值
        const getVal = (name) => {
            const el = rawElements.find(e => e.elementName === name);
            // 需注意不同元素的時間切分可能略有不同，這裡做簡單對應 (假設索引一致或相近)
            // 嚴謹作法應比對 startTime，但 F-D0047-091 結構通常是對齊的
            return el?.time[index]?.elementValue[0]?.value || "-";
        };

        return {
            startTime: slot.startTime,
            endTime: slot.endTime,
            weather: getVal("Wx"),
            rainProb: getVal("PoP12h"), // 若無值代表該時段無降雨機率資料(例如過遠的預報)
            temp: getVal("T"),
            humidity: getVal("RH"),
            windSpeed: getVal("WS") // 公尺/秒
        };
    });

    // E. 補充日出日落 (使用 SunCalc)
    // 依據每天產生一筆日出日落資料
    const dailyAstro = [];
    const today = new Date();
    for(let i=0; i<7; i++) {
        const d = new Date();
        d.setDate(today.getDate() + i);
        const times = SunCalc.getTimes(d, targetLat, targetLon);
        dailyAstro.push({
            date: d.toISOString().split('T')[0],
            sunrise: times.sunrise.toLocaleTimeString('zh-TW', {hour: '2-digit', minute:'2-digit', hour12: false}),
            sunset: times.sunset.toLocaleTimeString('zh-TW', {hour: '2-digit', minute:'2-digit', hour12: false})
        });
    }

    const finalResult = {
        city: targetCity,
        coords: { lat: targetLat, lon: targetLon },
        forecasts: formattedForecasts,
        astro: dailyAstro,
        lastUpdate: new Date().toISOString()
    };

    // 寫入快取
    cache.data[targetCity] = {
        timestamp: now,
        data: { success: true, data: finalResult }
    };

    res.json({ success: true, data: finalResult });

  } catch (error) {
    console.error("Server Error:", error.message);
    res.status(500).json({ error: "無法取得天氣資訊", details: error.message });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🛡️  Eco-Weather Service running on port ${PORT}`);
});