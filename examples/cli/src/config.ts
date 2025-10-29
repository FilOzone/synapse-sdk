import Conf from 'conf'

const packageJson = {
  name: 'synapse-cli',
  version: '1.0.0',
}

const schema = {
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
