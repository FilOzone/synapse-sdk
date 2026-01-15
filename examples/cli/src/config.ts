import Conf from 'conf'
import packageJson from '../package.json' with { type: 'json' }

const schema = {
  keystore: {
    type: 'string',
  },
  privateKey: {
    type: 'string',
  },
}

const config = new Conf<{ privateKey: string }>({
  projectName: packageJson.name,
  projectVersion: packageJson.version,
  schema,
})

export default config
