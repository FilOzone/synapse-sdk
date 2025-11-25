// Paul R Berg's Fixed-Precision Math Library for Solidity
// https://github.com/PaulRBerg/prb-math
// commit 1f0c080d02d165544b7aea840d1e8ae4dd44d49c
// UD60x18: 18 decimals

export const PRB_ONE = 10n ** 18n

export function prbDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator * PRB_ONE) / denominator
}

export function prbExp2(power: bigint): bigint {
  // Convert to 192.64
  const power64 = (power << 64n) / PRB_ONE

  let result = 0x800000000000000000000000000000000000000000000000n
  if ((power64 & 0xff00000000000000n) > 0n) {
    if ((power64 & 0x8000000000000000n) > 0n) {
      result = (result * 0x16a09e667f3bcc909n) >> 64n
    }
    if ((power64 & 0x4000000000000000n) > 0n) {
      result = (result * 0x1306fe0a31b7152dfn) >> 64n
    }
    if ((power64 & 0x2000000000000000n) > 0n) {
      result = (result * 0x1172b83c7d517adcen) >> 64n
    }
    if ((power64 & 0x1000000000000000n) > 0n) {
      result = (result * 0x10b5586cf9890f62an) >> 64n
    }
    if ((power64 & 0x800000000000000n) > 0n) {
      result = (result * 0x1059b0d31585743aen) >> 64n
    }
    if ((power64 & 0x400000000000000n) > 0n) {
      result = (result * 0x102c9a3e778060ee7n) >> 64n
    }
    if ((power64 & 0x200000000000000n) > 0n) {
      result = (result * 0x10163da9fb33356d8n) >> 64n
    }
    if ((power64 & 0x100000000000000n) > 0n) {
      result = (result * 0x100b1afa5abcbed61n) >> 64n
    }
  }

  if ((power64 & 0xff000000000000n) > 0n) {
    if ((power64 & 0x80000000000000n) > 0n) {
      result = (result * 0x10058c86da1c09ea2n) >> 64n
    }
    if ((power64 & 0x40000000000000n) > 0n) {
      result = (result * 0x1002c605e2e8cec50n) >> 64n
    }
    if ((power64 & 0x20000000000000n) > 0n) {
      result = (result * 0x100162f3904051fa1n) >> 64n
    }
    if ((power64 & 0x10000000000000n) > 0n) {
      result = (result * 0x1000b175effdc76ban) >> 64n
    }
    if ((power64 & 0x8000000000000n) > 0n) {
      result = (result * 0x100058ba01fb9f96dn) >> 64n
    }
    if ((power64 & 0x4000000000000n) > 0n) {
      result = (result * 0x10002c5cc37da9492n) >> 64n
    }
    if ((power64 & 0x2000000000000n) > 0n) {
      result = (result * 0x1000162e525ee0547n) >> 64n
    }
    if ((power64 & 0x1000000000000n) > 0n) {
      result = (result * 0x10000b17255775c04n) >> 64n
    }
  }

  if ((power64 & 0xff0000000000n) > 0n) {
    if ((power64 & 0x800000000000n) > 0n) {
      result = (result * 0x1000058b91b5bc9aen) >> 64n
    }
    if ((power64 & 0x400000000000n) > 0n) {
      result = (result * 0x100002c5c89d5ec6dn) >> 64n
    }
    if ((power64 & 0x200000000000n) > 0n) {
      result = (result * 0x10000162e43f4f831n) >> 64n
    }
    if ((power64 & 0x100000000000n) > 0n) {
      result = (result * 0x100000b1721bcfc9an) >> 64n
    }
    if ((power64 & 0x80000000000n) > 0n) {
      result = (result * 0x10000058b90cf1e6en) >> 64n
    }
    if ((power64 & 0x40000000000n) > 0n) {
      result = (result * 0x1000002c5c863b73fn) >> 64n
    }
    if ((power64 & 0x20000000000n) > 0n) {
      result = (result * 0x100000162e430e5a2n) >> 64n
    }
    if ((power64 & 0x10000000000n) > 0n) {
      result = (result * 0x1000000b172183551n) >> 64n
    }
  }

  if ((power64 & 0xff00000000n) > 0n) {
    if ((power64 & 0x8000000000n) > 0n) {
      result = (result * 0x100000058b90c0b49n) >> 64n
    }
    if ((power64 & 0x4000000000n) > 0n) {
      result = (result * 0x10000002c5c8601ccn) >> 64n
    }
    if ((power64 & 0x2000000000n) > 0n) {
      result = (result * 0x1000000162e42fff0n) >> 64n
    }
    if ((power64 & 0x1000000000n) > 0n) {
      result = (result * 0x10000000b17217fbbn) >> 64n
    }
    if ((power64 & 0x800000000n) > 0n) {
      result = (result * 0x1000000058b90bfcen) >> 64n
    }
    if ((power64 & 0x400000000n) > 0n) {
      result = (result * 0x100000002c5c85fe3n) >> 64n
    }
    if ((power64 & 0x200000000n) > 0n) {
      result = (result * 0x10000000162e42ff1n) >> 64n
    }
    if ((power64 & 0x100000000n) > 0n) {
      result = (result * 0x100000000b17217f8n) >> 64n
    }
  }

  if ((power64 & 0xff000000n) > 0n) {
    if ((power64 & 0x80000000n) > 0n) {
      result = (result * 0x10000000058b90bfcn) >> 64n
    }
    if ((power64 & 0x40000000n) > 0n) {
      result = (result * 0x1000000002c5c85fen) >> 64n
    }
    if ((power64 & 0x20000000n) > 0n) {
      result = (result * 0x100000000162e42ffn) >> 64n
    }
    if ((power64 & 0x10000000n) > 0n) {
      result = (result * 0x1000000000b17217fn) >> 64n
    }
    if ((power64 & 0x8000000n) > 0n) {
      result = (result * 0x100000000058b90c0n) >> 64n
    }
    if ((power64 & 0x4000000n) > 0n) {
      result = (result * 0x10000000002c5c860n) >> 64n
    }
    if ((power64 & 0x2000000n) > 0n) {
      result = (result * 0x1000000000162e430n) >> 64n
    }
    if ((power64 & 0x1000000n) > 0n) {
      result = (result * 0x10000000000b17218n) >> 64n
    }
  }

  if ((power64 & 0xff0000n) > 0n) {
    if ((power64 & 0x800000n) > 0n) {
      result = (result * 0x1000000000058b90cn) >> 64n
    }
    if ((power64 & 0x400000n) > 0n) {
      result = (result * 0x100000000002c5c86n) >> 64n
    }
    if ((power64 & 0x200000n) > 0n) {
      result = (result * 0x10000000000162e43n) >> 64n
    }
    if ((power64 & 0x100000n) > 0n) {
      result = (result * 0x100000000000b1721n) >> 64n
    }
    if ((power64 & 0x80000n) > 0n) {
      result = (result * 0x10000000000058b91n) >> 64n
    }
    if ((power64 & 0x40000n) > 0n) {
      result = (result * 0x1000000000002c5c8n) >> 64n
    }
    if ((power64 & 0x20000n) > 0n) {
      result = (result * 0x100000000000162e4n) >> 64n
    }
    if ((power64 & 0x10000n) > 0n) {
      result = (result * 0x1000000000000b172n) >> 64n
    }
  }

  if ((power64 & 0xff00n) > 0n) {
    if ((power64 & 0x8000n) > 0n) {
      result = (result * 0x100000000000058b9n) >> 64n
    }
    if ((power64 & 0x4000n) > 0n) {
      result = (result * 0x10000000000002c5dn) >> 64n
    }
    if ((power64 & 0x2000n) > 0n) {
      result = (result * 0x1000000000000162en) >> 64n
    }
    if ((power64 & 0x1000n) > 0n) {
      result = (result * 0x10000000000000b17n) >> 64n
    }
    if ((power64 & 0x800n) > 0n) {
      result = (result * 0x1000000000000058cn) >> 64n
    }
    if ((power64 & 0x400n) > 0n) {
      result = (result * 0x100000000000002c6n) >> 64n
    }
    if ((power64 & 0x200n) > 0n) {
      result = (result * 0x10000000000000163n) >> 64n
    }
    if ((power64 & 0x100n) > 0n) {
      result = (result * 0x100000000000000b1n) >> 64n
    }
  }

  if ((power64 & 0xffn) > 0n) {
    if ((power64 & 0x80n) > 0n) {
      result = (result * 0x10000000000000059n) >> 64n
    }
    if ((power64 & 0x40n) > 0n) {
      result = (result * 0x1000000000000002cn) >> 64n
    }
    if ((power64 & 0x20n) > 0n) {
      result = (result * 0x10000000000000016n) >> 64n
    }
    if ((power64 & 0x10n) > 0n) {
      result = (result * 0x1000000000000000bn) >> 64n
    }
    if ((power64 & 0x8n) > 0n) {
      result = (result * 0x10000000000000006n) >> 64n
    }
    if ((power64 & 0x4n) > 0n) {
      result = (result * 0x10000000000000003n) >> 64n
    }
    if ((power64 & 0x2n) > 0n) {
      result = (result * 0x10000000000000001n) >> 64n
    }
    if ((power64 & 0x1n) > 0n) {
      result = (result * 0x10000000000000001n) >> 64n
    }
  }

  return (result * PRB_ONE) >> (191n - (power64 >> 64n))
}
