import React, { useState, useEffect } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { View, Text, Input } from '@tarojs/components'
import { getTheme, onThemeChange, syncPageColors } from '../../utils/theme'
import './index.scss'

const SAMPLE_RESULTS = [
  {
    id: 1,
    name: '人形机器人',
    avgIncrease: '+8.48%',
    isUp: true,
    hot: 160,
    stocks: ['埃斯顿', '拓斯达', '汇川技术', '三花智控'],
    desc: '特斯拉Optimus引发全球人形机器人赛道爆发，国内产业链迎来重大机遇',
    gradient: ['#FF6B6B', '#FF8E53']
  },
  {
    id: 2,
    name: '具身智能',
    avgIncrease: '+3.21%',
    isUp: true,
    hot: 110,
    stocks: ['科大讯飞', '商汤科技', '优必选'],
    desc: '大模型与机器人融合，具身智能成为AI落地最关键的下一站',
    gradient: ['#9B59B6', '#7C6FFF']
  }
]

export default function Search() {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('idle')
  const [results, setResults] = useState([])
  const [addedIds, setAddedIds] = useState([])
  const [searchToast, setSearchToast] = useState('')
  const [theme, setTheme] = useState(getTheme)

  useEffect(() => {
    return onThemeChange(setTheme)
  }, [])

  useDidShow(() => {
    const t = getTheme()
    Taro.eventCenter.trigger('TAB_CHANGE', 1)
    setTheme(t)
    syncPageColors(t)
  })

  const handleSearch = () => {
    if (!query.trim() || status === 'loading') return
    setStatus('loading')
    setResults([])
    setSearchToast('')
    // Randomize cache hit for demo representation
    const isCached = Math.random() > 0.5

    // 模拟AI搜索2秒后返回结果
    setTimeout(() => {
      setResults(SAMPLE_RESULTS)
      setStatus('done')
      setSearchToast(isCached ? '✅ 缓存命中：已为您节省 5 积分' : '✨ AI 提炼完毕：消耗 10 积分')
      setTimeout(() => setSearchToast(''), 4500)
    }, 2000)
  }

  const handleAdd = (id) => {
    if (addedIds.includes(id)) return
    Taro.showToast({ title: '已加入自选', icon: 'success' })
    setAddedIds([...addedIds, id])
  }

  return (
    <View className={`page theme-${theme}`}>
      {/* 搜索头部 */}
      <View className='search-header'>
        <Text className='search-title'>AI 题材搜索</Text>
        <Text className='search-subtitle'>用自然语言描述题材，AI自动提炼成分股</Text>
        {searchToast && <Text className='credit-toast'>{searchToast}</Text>}
      </View>

      {/* 搜索框 */}
      <View className='search-box-wrap'>
        <View className='search-box'>
          <Text className='search-icon'>🔍</Text>
          <Input
            className='search-input'
            value={query}
            onInput={(e) => setQuery(e.detail.value)}
            placeholder='例如：马斯克旗下公司相关概念'
            placeholderClass='input-placeholder'
            onConfirm={handleSearch}
            confirmType='search'
          />
        </View>
        <View
          className={`search-btn ${status === 'loading' ? 'loading' : ''}`}
          onClick={handleSearch}
        >
          <Text className='search-btn-text'>{status === 'loading' ? '搜索中…' : '搜索'}</Text>
        </View>
      </View>

      {/* AI思考动画 */}
      {status === 'loading' && (
        <View className='thinking-area'>
          <View className='thinking-dots'>
            <View className='dot dot1' />
            <View className='dot dot2' />
            <View className='dot dot3' />
          </View>
          <Text className='thinking-text'>AI 正在分析题材，召唤成分股…</Text>
        </View>
      )}

      {/* 搜索结果 */}
      {status === 'done' && (
        <View className='results-area'>
          <Text className='results-label'>找到 {results.length} 个相关题材</Text>
          {results.map((item) => (
            <View key={item.id} className='result-card'>
              <View
                className='card-accent-top'
                style={{ background: `linear-gradient(to right, ${item.gradient[0]}, ${item.gradient[1]})` }}
              />
              <View className='result-inner'>
                <View className='result-row-top'>
                  <Text className='result-name'>{item.name}</Text>
                  <View className={`change-badge ${item.isUp ? 'up' : 'down'}`}>
                    <Text className='change-text'>{item.avgIncrease}</Text>
                  </View>
                </View>
                <Text className='result-desc'>{item.desc}</Text>
                <View className='result-stocks'>
                  {item.stocks.map((s, i) => (
                    <View key={i} className='stock-tag'>
                      <Text className='stock-name'>{s}</Text>
                    </View>
                  ))}
                </View>
                <View className='add-btn-wrap'>
                  <View 
                    className={`add-btn ${addedIds.includes(item.id) ? 'added' : ''}`}
                    onClick={() => handleAdd(item.id)}
                  >
                    <Text className='add-btn-text'>
                      {addedIds.includes(item.id) ? '已加入自选' : '＋ 加入自选'}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* 空态提示 */}
      {status === 'idle' && (
        <View className='idle-area'>
          <Text className='idle-icon'>✨</Text>
          <Text className='idle-text'>输入任意题材关键词{'\n'}AI 将自动提炼成分股列表</Text>
          <Text className='credit-hint'>💡 每次搜索消耗 10 积分 (缓存命中减半)</Text>
        </View>
      )}
    </View>
  )
}
