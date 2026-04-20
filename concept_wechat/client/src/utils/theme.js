import Taro from '@tarojs/taro'

const STORAGE_KEY = 'APP_THEME'
const EVENT_KEY = 'THEME_CHANGE'

export function getTheme() {
  return Taro.getStorageSync(STORAGE_KEY) || 'dark'
}

export function applyTheme(theme) {
  Taro.setStorageSync(STORAGE_KEY, theme)
  Taro.eventCenter.trigger(EVENT_KEY, theme)
  syncPageColors(theme)
}

export function syncPageColors(theme) {
  const isLight = theme === 'light'
  const bgColor = isLight ? '#f0f3ff' : '#0a0a14'
  const frontColor = isLight ? '#000000' : '#ffffff'
  Taro.setNavigationBarColor({
    frontColor,
    backgroundColor: bgColor,
    animation: { duration: 200, timingFunc: 'easeIn' }
  })
  Taro.setBackgroundColor({
    backgroundColor: bgColor,
    backgroundColorTop: bgColor,
    backgroundColorBottom: bgColor
  })
}

export function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  return next
}

/**
 * 在组件中使用: const { theme, useThemeListener } = useTheme()
 * 在 useEffect 里调用 useThemeListener(setTheme)
 */
export function onThemeChange(handler) {
  Taro.eventCenter.on(EVENT_KEY, handler)
  return () => Taro.eventCenter.off(EVENT_KEY, handler)
}
