import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'io.github.fzn0x.jumpman',
  appName: 'Jumpman',
  webDir: 'dist',
  backgroundColor: '#1C1C1E',
  android: {
    backgroundColor: '#1C1C1E',
    allowMixedContent: false,
  },
}

export default config
