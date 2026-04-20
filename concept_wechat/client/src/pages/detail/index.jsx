import React, { useState, useEffect, useRef } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { View, Text, ScrollView, Canvas } from '@tarojs/components'
import { getTheme, onThemeChange, syncPageColors } from '../../utils/theme'
import './index.scss'

// ---- 职业配置表 ----
const RPG_CLASSES = {
  paladin:  { name: '圣骑士', icon: '🛡️', color: '#FFD700', desc: '大盘成长' },
  mage:     { name: '法师',   icon: '🔮', color: '#9B8CFF', desc: '小盘成长' },
  warrior:  { name: '战士',   icon: '⚔️', color: '#FF6B6B', desc: '大盘价值' },
  priest:   { name: '牧师',   icon: '✨', color: '#3DE88A', desc: '小盘价值' },
  assassin: { name: '刺客',   icon: '🗡️', color: '#FF8E53', desc: '高弹性' },
  ranger:   { name: '游侠',   icon: '🏹', color: '#4ECDC4', desc: '周期成长' }
}

// ---- 出战股票 ----
const INITIAL_STOCKS = {
  1: [
    { id: 's1', name: '航天彩虹', code: '002419', change: '+3.25%', isUp: true, volume: '12.6亿', limitUpGene: 4, rpgClass: 'assassin', stats: { hp: 45, mp: 85, int: 60, agi: 90, str: 20 }, reason: '卫星通信天线核心供应商，直接受益于低轨星座建设提速，订单高增长确定性强。' },
    { id: 's2', name: '中国卫通', code: '601698', change: '+1.88%', isUp: true, volume: '22.1亿', limitUpGene: 2, rpgClass: 'paladin', stats: { hp: 88, mp: 45, int: 55, agi: 40, str: 60 }, reason: '国资背景卫星运营商，高频段通信资源稀缺，政策护航下稳健扩张。' },
    { id: 's3', name: '海格通信', code: '002465', change: '+5.60%', isUp: true, volume: '8.3亿', limitUpGene: 5, rpgClass: 'mage', stats: { hp: 38, mp: 95, int: 70, agi: 88, str: 15 }, reason: '军民两用通信终端龙头，星链干扰检测设备新品打开增量空间。' }
  ],
  3: [
    { id: 's4', name: '中信海直', code: '000099', change: '+4.12%', isUp: true, volume: '6.8亿', limitUpGene: 3, rpgClass: 'ranger', stats: { hp: 55, mp: 60, int: 50, agi: 65, str: 45 }, reason: '低空运营先行者，拥有国内最大直升机机队，eVTOL运营牌照布局提前。' },
    { id: 's5', name: '万丰奥威', code: '002085', change: '+7.33%', isUp: true, volume: '18.4亿', limitUpGene: 5, rpgClass: 'assassin', stats: { hp: 50, mp: 92, int: 72, agi: 85, str: 10 }, reason: '通航发动机龙头，已签署多家eVTOL企业配套协议，产品定点落地进程最快。' }
  ]
}

// ---- 候补池 ----
const RESERVE_POOL = {
  1: [
    { id: 'r1', name: '中国卫星', code: '600118', change: '+2.11%', isUp: true, volume: '5.8亿', limitUpGene: 3, rpgClass: 'warrior', stats: { hp: 75, mp: 55, int: 45, agi: 50, str: 55 }, reason: '国际卫星通信龙头，在轨运营卫星资源全国领先，低轨商业化受益确定性高。' },
    { id: 'r2', name: '振芯科技', code: '300101', change: '+4.55%', isUp: true, volume: '3.2亿', limitUpGene: 4, rpgClass: 'mage', stats: { hp: 30, mp: 80, int: 65, agi: 85, str: 10 }, reason: '北斗芯片核心厂商，低轨卫星终端需求爆发带动出货量高增长，估值弹性大。' },
    { id: 'r3', name: '盟升电子', code: '688311', change: '+1.70%', isUp: true, volume: '2.4亿', limitUpGene: 2, rpgClass: 'ranger', stats: { hp: 28, mp: 65, int: 72, agi: 60, str: 20 }, reason: '北斗/卫星通信终端产品线覆盖完整，军民两用渗透率持续提升。' }
  ],
  3: [
    { id: 'r4', name: '光线传媒', code: '300251', change: '+0.88%', isUp: true, volume: '4.1亿', limitUpGene: 2, rpgClass: 'priest', stats: { hp: 60, mp: 40, int: 35, agi: 45, str: 70 }, reason: '低空经济配套文旅内容场景运营，政策受益边际叠加业绩稳定性强。' },
    { id: 'r5', name: '北摩高科', code: '838382', change: '+3.22%', isUp: true, volume: '1.8亿', limitUpGene: 4, rpgClass: 'assassin', stats: { hp: 22, mp: 88, int: 60, agi: 92, str: 8 }, reason: '直升机刹车系统核心供应商，国产替代逻辑叠加低空经济，弹性极高。' }
  ]
}

// ============ 图表数据 ============
const INTRADAY_PTS = [100.0,100.3,100.8,101.2,100.9,101.5,102.0,102.8,103.1,102.7,103.5,104.0,104.3,103.8,104.5,105.1,105.6,105.2,106.0,106.5,106.1,107.0,107.4,107.0,106.8,107.3,108.0,108.5,108.2,109.0,109.5,110.0,109.6,110.3,110.8,111.2,110.9,111.5,112.0,112.6,112.2,113.0,113.5,114.0,113.6,114.3,115.0,115.5,115.1,116.0,116.4,116.0,117.0,117.5,118.0,117.6,118.4,119.0,119.5,120.0]
const DAILY_OHLC = [[96,99,94,98],[98,101,97,100],[100,104,99,103],[103,106,101,104],[104,103,101,102],[102,105,101,104],[104,108,103,107],[107,110,106,109],[109,108,106,107],[107,111,106,110],[110,114,109,113],[113,112,110,111],[111,115,110,114],[114,118,113,117],[117,116,114,115],[115,119,114,118],[118,122,117,121],[121,120,118,119],[119,123,118,122],[122,126,121,125]]
const WEEKLY_OHLC = [[88,94,86,92],[92,96,90,94],[94,92,89,90],[90,97,89,96],[96,101,95,100],[100,98,96,97],[97,103,96,102],[102,107,101,106],[106,105,102,103],[103,110,102,109],[109,115,108,114],[114,126,113,125]]
const LABELS = { intraday:['09:30','10:30','11:30','13:00','14:00','15:00'], daily:['3/20','3/25','3/28','4/1','4/3','4/6'], weekly:['1月','2月','3月初','3月中','3月末','4月'] }

function drawIntradayChart(ctx, w, h, isUp) {
  const pts = INTRADAY_PTS, max = Math.max(...pts), min = Math.min(...pts), range = max - min || 1
  const pL=4,pR=4,pT=12,pB=12,cw=w-pL-pR,ch=h-pT-pB
  const toX=(i)=>pL+(i/(pts.length-1))*cw, toY=(v)=>pT+ch-((v-min)/range)*ch
  const lineColor = isUp ? '#FF5C5C' : '#3DE88A'
  ctx.setLineDash([5,4]); ctx.strokeStyle='rgba(255,255,255,0.1)'; ctx.lineWidth=1
  ctx.beginPath(); ctx.moveTo(pL,pT+ch/2); ctx.lineTo(w-pR,pT+ch/2); ctx.stroke(); ctx.setLineDash([])
  const grad = ctx.createLinearGradient(0,pT,0,h)
  grad.addColorStop(0, isUp?'rgba(255,92,92,0.35)':'rgba(61,232,138,0.35)'); grad.addColorStop(1,'rgba(0,0,0,0)')
  ctx.beginPath(); pts.forEach((v,i)=>i===0?ctx.moveTo(toX(i),toY(v)):ctx.lineTo(toX(i),toY(v)))
  ctx.lineTo(toX(pts.length-1),h-pB); ctx.lineTo(pL,h-pB); ctx.closePath(); ctx.fillStyle=grad; ctx.fill()
  ctx.beginPath(); pts.forEach((v,i)=>i===0?ctx.moveTo(toX(i),toY(v)):ctx.lineTo(toX(i),toY(v)))
  ctx.strokeStyle=lineColor; ctx.lineWidth=2; ctx.lineJoin='round'; ctx.lineCap='round'; ctx.stroke()
}
function drawKChart(ctx, w, h, ohlcData) {
  const allVals=ohlcData.flat(), max=Math.max(...allVals), min=Math.min(...allVals), range=max-min||1
  const pL=4,pR=4,pT=12,pB=12,cw=w-pL-pR,ch=h-pT-pB,n=ohlcData.length,step=cw/n
  const toY=(v)=>pT+ch-((v-min)/range)*ch
  ctx.setLineDash([4,4]); ctx.strokeStyle='rgba(255,255,255,0.07)'; ctx.lineWidth=1
  ;[0.25,0.5,0.75].forEach(r=>{ctx.beginPath();ctx.moveTo(pL,pT+r*ch);ctx.lineTo(w-pR,pT+r*ch);ctx.stroke()})
  ctx.setLineDash([])
  ohlcData.forEach(([o,hi,lo,c],i)=>{
    const isUp=c>=o, color=isUp?'#FF5C5C':'#3DE88A', x=pL+step*i+step/2, candleW=Math.max(step*0.55,3)
    const bodyTop=toY(Math.max(o,c)), bodyBot=toY(Math.min(o,c)), bodyH=Math.max(bodyBot-bodyTop,2)
    ctx.strokeStyle=color; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(x,toY(hi)); ctx.lineTo(x,toY(lo)); ctx.stroke()
    ctx.fillStyle=color; ctx.fillRect(x-candleW/2,bodyTop,candleW,bodyH)
  })
}

function PriceChart({ chartTab, isUp }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      Taro.createSelectorQuery().select('#priceChart').fields({node:true,size:true}).exec((res)=>{
        if(!res||!res[0]||!res[0].node) return
        const canvas=res[0].node, ctx=canvas.getContext('2d'), w=res[0].width, h=res[0].height
        if(!w||!h) return
        const dpr=Taro.getSystemInfoSync().pixelRatio||1
        canvas.width=w*dpr; canvas.height=h*dpr; ctx.scale(dpr,dpr); ctx.clearRect(0,0,w,h)
        if(chartTab==='intraday') drawIntradayChart(ctx,w,h,isUp)
        else drawKChart(ctx,w,h,chartTab==='daily'?DAILY_OHLC:WEEKLY_OHLC)
      })
    }, 150)
    return () => clearTimeout(timer)
  }, [chartTab, isUp])
  return (
    <View className='chart-wrap'>
      <Canvas id='priceChart' type='2d' style='width:100%;height:200px;display:block;' />
      <View className='chart-labels'>
        {LABELS[chartTab].map((l,i)=><Text key={i} className='chart-label'>{l}</Text>)}
      </View>
    </View>
  )
}

// ============ 属性条 ============
function StatBar({ icon, label, value, pct, color, practical }) {
  return (
    <View className='stat-row'>
      <Text className='stat-icon'>{icon}</Text>
      <View className='stat-main'>
        <View className='stat-header'>
          <Text className='stat-name'>{label}</Text>
          <Text className='stat-practical'>{practical}</Text>
        </View>
        <View className='stat-track'>
          <View className='stat-fill' style={{ width: `${pct}%`, background: color }} />
        </View>
      </View>
      <Text className='stat-val'>{value}</Text>
    </View>
  )
}

function LimitStars({ count }) {
  return (
    <View className='limit-stars'>
      {[1,2,3,4,5].map(i=><Text key={i} className={`star ${i<=count?'star-on':'star-off'}`}>★</Text>)}
    </View>
  )
}

// ============ 股票卡片（支持长按移除）============
function StockCard({ stock, onBan, isRemoving, isAdding }) {
  const cls = RPG_CLASSES[stock.rpgClass]

  const handleLongPress = () => {
    if (isRemoving) return
    Taro.vibrateShort({ type: 'medium' }).catch(() => {})
    Taro.showActionSheet({
      itemList: ['⛔ 移除该成分股'],
      itemColor: '#FF5C5C',
      success: (res) => {
        if (res.tapIndex === 0) {
          onBan(stock.id, stock.name)
        }
      }
    }).catch(() => {})
  }

  return (
    <View className={`anim-wrapper ${isRemoving ? 'anim-remove' : ''} ${isAdding ? 'anim-add' : ''}`}>
      <View
        className='stock-card'
        onLongPress={handleLongPress}
      >
        <View className='stock-class-bar' style={{ background: cls.color }} />
        <View className='stock-inner'>

          {/* 职业 + 名称 */}
          <View className='stock-row-top'>
            <View className='class-badge' style={{ background: `${cls.color}22`, borderColor: `${cls.color}55` }}>
              <Text className='class-icon'>{cls.icon}</Text>
              <Text className='class-name' style={{ color: cls.color }}>{cls.name}</Text>
              <Text className='class-desc'>{cls.desc}</Text>
            </View>
            <View className='stock-name-group'>
              <Text className='stock-name'>{stock.name}</Text>
              <Text className='stock-code'>{stock.code}</Text>
            </View>
          </View>

          {/* 涨幅 + 成交额 + 涨停星 */}
          <View className='stock-row-meta'>
            <View className={`change-pill ${stock.isUp ? 'up' : 'down'}`}>
              <Text className='change-num'>{stock.change}</Text>
            </View>
            <Text className='meta-text'>成交额 {stock.volume}</Text>
            <LimitStars count={stock.limitUpGene} />
          </View>

          {/* 属性面板 */}
          <View className='stats-panel'>
            <StatBar icon='♥' label='体力' practical='市值' value={`${stock.stats.hp}亿`} pct={stock.stats.hp} color='#FF5C5C' />
            <StatBar icon='🔷' label='法力' practical='涨停基因' value={`${stock.limitUpGene}星`} pct={stock.stats.mp} color='#9B8CFF' />
            <StatBar icon='💡' label='智慧' practical='预期增速' value={`+${stock.stats.int}%`} pct={stock.stats.int} color='#FFD700' />
            <StatBar icon='💨' label='灵巧' practical='波动率' value={stock.stats.agi > 70 ? '高' : '中'} pct={stock.stats.agi} color='#3DE88A' />
            <StatBar icon='⭐' label='力量' practical='分红率' value={`${(stock.stats.str/30).toFixed(1)}%`} pct={stock.stats.str} color='#FF8E53' />
          </View>

          {/* 入选理由 */}
          <View className='reason-box'>
            <Text className='reason-label'>📌 入选理由</Text>
            <Text className='reason-text'>{stock.reason}</Text>
          </View>
        </View>
      </View>
    </View>
  )
}

// ============ 主页面 ============
export default function Detail() {
  const [theme, setTheme] = useState(getTheme)
  const [chartTab, setChartTab] = useState('intraday')

  const params = Taro.getCurrentInstance().router?.params || {}
  const id = parseInt(params.id) || 1
  const name = decodeURIComponent(params.name || 'SpaceX 概念股')
  const change = decodeURIComponent(params.change || '+4.25%')
  const isUp = params.isUp !== 'false'
  const hot = parseInt(params.hot) || 98

  const [stocks, setStocks] = useState(() => [...(INITIAL_STOCKS[id] || INITIAL_STOCKS[1])])
  const [reserves, setReserves] = useState(() => [...(RESERVE_POOL[id] || RESERVE_POOL[1])])
  const [removingId, setRemovingId] = useState(null)
  const [addingId, setAddingId] = useState(null)
  const [toast, setToast] = useState('')

  useEffect(() => { return onThemeChange(setTheme) }, [])
  useDidShow(() => { const t=getTheme(); setTheme(t); syncPageColors(t) })

  // ---- Ban 逻辑 ----
  const handleBan = (stockId, stockName) => {
    if (removingId) return  // 动画中禁止重复触发
    setRemovingId(stockId)

    setTimeout(() => {
      const removedStock = stocks.find(s => s.id === stockId)
      const newStocks = stocks.filter(s => s.id !== stockId)
      setRemovingId(null)

      if (reserves.length > 0) {
        const [incoming, ...rest] = reserves
        setReserves([...rest, removedStock])
        setAddingId(incoming.id)
        setStocks([...newStocks, incoming])
        setToast(`已移除 ${stockName}，${incoming.name} 候补上场！⚔️`)
        setTimeout(() => setAddingId(null), 600)
      } else {
        setReserves([removedStock])
        setStocks(newStocks)
        setToast(`已移除 ${stockName}，转入候补队伍`)
      }
      setTimeout(() => setToast(''), 3000)
    }, 380)
  }

  const CHART_TABS = [
    { key: 'intraday', label: '分时' },
    { key: 'daily',    label: '日K' },
    { key: 'weekly',   label: '周K' }
  ]

  return (
    <View className={`page theme-${theme}`}>
      {/* Toast 提示 */}
      {toast !== '' && (
        <View className='toast-wrap'>
          <Text className='toast-text'>{toast}</Text>
        </View>
      )}

      {/* 头部 */}
      <View className='detail-header'>
        <View className='header-row'>
          <Text className='header-name'>{name}</Text>
          <View className={`header-change ${isUp ? 'up' : 'down'}`}>
            <Text className='header-change-num'>{change}</Text>
          </View>
        </View>
        <View className='header-meta'>
          {[
            { label: '热度', value: hot },
            { label: '出战', value: `${stocks.length} 只` },
            { label: '候补', value: `${reserves.length} 只` },
            { label: '最高', value: '+5.8%', cls: 'up-text' }
          ].map((m, i) => [
            i > 0 && <View key={`d${i}`} className='meta-divider' />,
            <View key={m.label} className='meta-item'>
              <Text className='meta-label'>{m.label}</Text>
              <Text className={`meta-value ${m.cls || ''}`}>{m.value}</Text>
            </View>
          ])}
        </View>
      </View>

      {/* 图表 */}
      <View className='chart-section'>
        <View className='chart-tabs'>
          {CHART_TABS.map(tab => (
            <View key={tab.key} className={`chart-tab ${chartTab===tab.key?'active':''}`} onClick={()=>setChartTab(tab.key)}>
              <Text className='chart-tab-text'>{tab.label}</Text>
            </View>
          ))}
        </View>
        <PriceChart chartTab={chartTab} isUp={isUp} />
      </View>

      {/* 成分股列表 */}
      <View className='section-header'>
        <Text className='section-title'>⚔️ 出战阵容 ({stocks.length})</Text>
        <Text className='section-hint'>长按卡片可移除股票</Text>
      </View>

      <ScrollView scrollY className='stocks-scroll'>
        {stocks.map(stock => (
          <StockCard
            key={stock.id}
            stock={stock}
            onBan={handleBan}
            isRemoving={removingId === stock.id}
            isAdding={addingId === stock.id}
          />
        ))}

        {/* 候补池展示 */}
        {reserves.length > 0 && (
          <View className='reserve-section'>
            <Text className='reserve-title'>🪑 候补席位 ({reserves.length} 只)</Text>
            {reserves.map(s => {
              const cls = RPG_CLASSES[s.rpgClass]
              return (
                <View key={s.id} className='reserve-card'>
                  <View className='reserve-class-dot' style={{ background: cls.color }} />
                  <Text className='reserve-icon'>{cls.icon}</Text>
                  <View className='reserve-info'>
                    <Text className='reserve-name'>{s.name}</Text>
                    <Text className='reserve-code'>{s.code}</Text>
                  </View>
                  <Text className={`reserve-change ${s.isUp ? 'up-text' : 'down-text'}`}>{s.change}</Text>
                </View>
              )
            })}
          </View>
        )}

        <View className='list-bottom-spacer' />
      </ScrollView>
    </View>
  )
}
