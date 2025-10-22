import { type EIP1193Provider, getOrInstallSnap } from 'filsnap-adapter'
import { useAccountEffect } from 'wagmi'

const SNAP_ID = 'npm:filsnap' //'local:http://localhost:8080'
// const SNAP_ID = 'local:http://localhost:8080'

export const useFilsnap = ({ version, force }: { version?: string; force?: boolean } = {}) => {
  useAccountEffect({
    onConnect: async (data) => {
      const provider = (await data.connector.getProvider()) as EIP1193Provider
      if (provider.isMetaMask) {
        await getOrInstallSnap(provider, SNAP_ID, version ?? '*', force)
      }
    },
  })
}
