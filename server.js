require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const SunCalc = require("suncalc");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const CWA_API_KEY = process.env.CWA_API_KEY;

// === 1. 資安與白名單設定 ===
app.use(helmet()); 

const whitelist = [
  'http://localhost:3000',
  'http://127.0.0.1:5500', 
  'http://localhost:5500',
  'https://wang-yi-zhang.github.io' // 您的 GitHub Pages
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || whitelist.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log("Blocked by CORS:", origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));

// 速率限制
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100,
  message: { error: "請求過於頻繁，請稍後再試" }
});
app.use("/api/", limiter);
app.use(express.json());

// 首頁路由 (確認服務存活)
app.get('/', (req, res) => {
    res.send('☁️ Eco-Weather API is Running (City Level Mode)');
});

// === 2. 靜態資料 (僅保留縣市中心點) ===
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

const cache = {
  data: {},
  duration: 10 * 60 * 1000 // 快取 10 分鐘
};

// === 3. 核心 API ===

app.get("/api/weather/week", async (req, res) => {
  try {
    let { city, lat, lon } = req.query;
    
    // 1. 定位邏輯 (找出最近的縣市)
    let cityObj = null;
    if (lat && lon) {
      let minDistance = Infinity;
      COUNTIES.forEach(c => {
        const dist = getDistanceFromLatLonInKm(lat, lon, c.lat, c.lon);
        if (dist < minDistance) {
          minDistance = dist;
          cityObj = c;
        }
      });
    } else if (city) {
        cityObj = COUNTIES.find(c => c.name === city);
    }

    if (!cityObj) return res.status(400).json({ error: "找不到該縣市資料" });

    const targetCity = cityObj.name; // 直接使用縣市名稱 (e.g., "臺北市")
    const targetLat = cityObj.lat;
    const targetLon = cityObj.lon;

    // 2. 檢查快取
    const now = Date.now();
    if (cache.data[targetCity] && (now - cache.data[targetCity].timestamp < cache.duration)) {
      console.log(`[Cache Hit] ${targetCity}`);
      return res.json(cache.data[targetCity].data);
    }

    // 3. 呼叫 CWA API (F-D0047-091)
    const apiUrl = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-091";
    console.log(`Fetching CWA: ${targetCity}`);
    
    const response = await axios.get(apiUrl, {
      params: {
        Authorization: CWA_API_KEY,
        locationName: targetCity, // 直接傳 "臺北市"
        sort: "time"
      }
    });

    // 4. 解析 JSON
    // 注意：結構是 records.Locations[0].Location[0]
    const records = response.data.records;
    if (!records.Locations || !records.Locations[0] || !records.Locations[0].Location) {
        // 如果 API Key 權限有問題或參數錯誤，這裡會抓不到
        throw new Error("API 回傳結構異常，可能無此縣市資料");
    }
    
    // 取得該縣市的資料物件
    const locationData = records.Locations[0].Location[0];
    const weatherElements = locationData.WeatherElement;

    // 輔助函式：根據中文名稱與英文 Key 抓取數值
    const getValue = (chineseName, valueKey, timeIndex) => {
        const el = weatherElements.find(e => e.ElementName === chineseName);
        if (!el || !el.Time[timeIndex]) return "-";
        return el.Time[timeIndex].ElementValue[0][valueKey];
    };

    // 以 "天氣現象" 的時間軸當作基準
    const timeBase = weatherElements.find(e => e.ElementName === "天氣現象").Time;

    const formattedForecasts = timeBase.map((t, i) => {
        return {
            startTime: t.StartTime,
            endTime: t.EndTime,
            // 對應中文欄位名稱
            weather: t.ElementValue[0].Weather, 
            rainProb: getValue("12小時降雨機率", "ProbabilityOfPrecipitation", i),
            temp: getValue("平均溫度", "Temperature", i),
            humidity: getValue("平均相對濕度", "RelativeHumidity", i),
            windSpeed: getValue("風速", "WindSpeed", i)
        };
    });

    // 5. 補充日出日落 (計算未來 7 天)
    const dailyAstro = [];
    const today = new Date();
    // 定義台灣時間格式選項
    const twTimeOptions = {
        timeZone: "Asia/Taipei", // ★ 強制指定台灣時區
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    };

    for(let i=0; i<7; i++) {
        const d = new Date();
        d.setDate(today.getDate() + i);
        
        // SunCalc 算出的是 UTC 時間物件
        const times = SunCalc.getTimes(d, targetLat, targetLon);
        
        // 透過 toLocaleTimeString 轉成台灣時間字串
        dailyAstro.push({
            date: d.toISOString().split('T')[0],
            sunrise: times.sunrise.toLocaleTimeString("zh-TW", twTimeOptions),
            sunset: times.sunset.toLocaleTimeString("zh-TW", twTimeOptions)
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
    res.status(500).json({ error: "API Error", details: error.message });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🛡️  Eco-Weather Service running on port ${PORT}`);
});