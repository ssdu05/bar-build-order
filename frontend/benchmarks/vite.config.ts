import { fileURLToPath } from 'node:url'
import { mergeConfig } from 'vite'
import base from '../vite.config.ts'

export default mergeConfig(base, {
  build: {
    rolldownOptions: {
      input: fileURLToPath(new URL('./recording-slider.html', import.meta.url)),
    },
  },
})
