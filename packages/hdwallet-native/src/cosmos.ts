import * as core from "@shapeshiftoss/hdwallet-core";
import { BIP32Interface } from "bitcoinjs-lib";

import txBuilder from "cosmos-tx-builder";
import * as bitcoin from "bitcoinjs-lib";
import { NativeHDWalletBase } from "./native";
import { getNetwork } from "./networks";
import { mnemonicToSeed } from "bip39";
import { toWords, encode } from "bech32";
import CryptoJS, { RIPEMD160, SHA256 } from "crypto-js";
import { getKeyPair } from "./util";

const ATOM_CHAIN = "cosmoshub-3";

export function MixinNativeCosmosWalletInfo<TBase extends core.Constructor>(Base: TBase) {
  return class MixinNativeCosmosWalletInfo extends Base implements core.CosmosWalletInfo {
    _supportsCosmosInfo = true;
    async cosmosSupportsNetwork(): Promise<boolean> {
      return true;
    }

    async cosmosSupportsSecureTransfer(): Promise<boolean> {
      return false;
    }

    cosmosSupportsNativeShapeShift(): boolean {
      return false;
    }

    cosmosGetAccountPaths(msg: core.CosmosGetAccountPaths): Array<core.CosmosAccountPath> {
      return [
        {
          addressNList: [0x80000000 + 44, 0x80000000 + 117, 0x80000000 + msg.accountIdx, 0, 0],
        },
      ];
    }

    cosmosNextAccountPath(msg: core.CosmosAccountPath): core.CosmosAccountPath {
      // Only support one account for now (like portis).
      return undefined;
    }
  };
}

export function MixinNativeCosmosWallet<TBase extends core.Constructor<NativeHDWalletBase>>(Base: TBase) {
  return class MixinNativeCosmosWallet extends Base {
    _supportsCosmos = true;
    #wallet: BIP32Interface;

    async cosmosInitializeWallet(mnemonic: string): Promise<void> {
      const network = getNetwork("cosmos");
      this.#wallet = bitcoin.bip32.fromSeed(await mnemonicToSeed(mnemonic), network);
    }

    cosmosWipe(): void {
      this.#wallet = undefined;
    }

    bech32ify(address: ArrayLike<number>, prefix: string): string {
      const words = toWords(address);
      return encode(prefix, words);
    }

    createCosmosAddress(publicKey: string) {
      const message = SHA256(CryptoJS.enc.Hex.parse(publicKey));
      const hash = RIPEMD160(message as any).toString();
      const address = Buffer.from(hash, `hex`);
      return this.bech32ify(address, `cosmos`);
    }

    async cosmosGetAddress(msg: core.CosmosGetAddress): Promise<string> {
      return this.needsMnemonic(!!this.#wallet, async () => {
        return this.createCosmosAddress(getKeyPair(this.#wallet, msg.addressNList, "cosmos").publicKey);
      });
    }

    async cosmosSignTx(msg: core.CosmosSignTx): Promise<core.CosmosSignedTx> {
      return this.needsMnemonic(!!this.#wallet, async () => {
        const keyPair = getKeyPair(this.#wallet, msg.addressNList, "cosmos");
        const result = await txBuilder.sign(msg.tx, keyPair, msg.sequence, msg.account_number, ATOM_CHAIN);

        return txBuilder.createSignedTx(msg.tx, result);
      });
    }
  };
}
