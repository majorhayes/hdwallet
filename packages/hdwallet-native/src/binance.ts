import * as core from "@shapeshiftoss/hdwallet-core";
import { BIP32Interface } from "bitcoinjs-lib";

import BncClient from "bnb-javascript-sdk-nobroadcast";
import * as bitcoin from "bitcoinjs-lib";
import { NativeHDWalletBase } from "./native";
import { getNetwork } from "./networks";
import { mnemonicToSeed } from "bip39";
import { toWords, encode } from "bech32";
import CryptoJS, { RIPEMD160, SHA256 } from "crypto-js";
import { getKeyPair } from "./util";

export function MixinNativeBinanceWalletInfo<TBase extends core.Constructor>(Base: TBase) {
  return class MixinNativeBinanceWalletInfo extends Base implements core.BinanceWalletInfo {
    _supportsBinanceInfo = true;

    async binanceSupportsNetwork(): Promise<boolean> {
      return true;
    }

    async binanceSupportsSecureTransfer(): Promise<boolean> {
      return false;
    }

    binanceSupportsNativeShapeShift(): boolean {
      return false;
    }

    binanceGetAccountPaths(msg: core.BinanceGetAccountPaths): Array<core.BinanceAccountPath> {
      return [
        {
          addressNList: [0x80000000 + 44, 0x80000000 + 117, 0x80000000 + msg.accountIdx, 0, 0],
        },
      ];
    }

    binanceNextAccountPath(msg: core.BinanceAccountPath): core.BinanceAccountPath {
      // Only support one account for now (like portis).
      return undefined;
    }
  };
}

export function MixinNativeBinanceWallet<TBase extends core.Constructor<NativeHDWalletBase>>(Base: TBase) {
  return class MixinNativeBinanceWallet extends Base {
    _supportsBinance = true;
    #wallet: BIP32Interface;

    async binanceInitializeWallet(mnemonic: string): Promise<void> {
      const network = getNetwork("cosmos");
      this.#wallet = bitcoin.bip32.fromSeed(await mnemonicToSeed(mnemonic), network);
    }

    binanceWipe(): void {
      this.#wallet = undefined;
    }

    bech32ify(address: ArrayLike<number>, prefix: string): string {
      const words = toWords(address);
      return encode(prefix, words);
    }

    createBinanceAddress(publicKey: string) {
      const message = SHA256(CryptoJS.enc.Hex.parse(publicKey));
      const hash = RIPEMD160(message as any).toString();
      const address = Buffer.from(hash, `hex`);
      return this.bech32ify(address, `bnb`);
    }

    async binanceGetAddress(msg: core.BinanceGetAddress): Promise<string> {
      return this.needsMnemonic(!!this.#wallet, async () => {
        return this.createBinanceAddress(getKeyPair(this.#wallet, msg.addressNList, "binance").publicKey);
      });
    }

    async binanceSignTx(msg: core.BinanceSignTx): Promise<core.BinanceSignedTx> {
      return this.needsMnemonic(!!this.#wallet, async () => {
        // use sdk to build Amino encoded hex transaction
        const client = new BncClient("https://dex.binance.org"); // broadcast not used but available
        await client.chooseNetwork("mainnet");
        await client.setPrivateKey(getKeyPair(this.#wallet, msg.addressNList, "binance").privateKey);
        await client.initChain();

        const addressFrom = msg.tx.msgs[0].inputs[0].address;
        const addressTo = msg.tx.msgs[0].outputs[0].address;
        const amount = msg.tx.msgs[0].inputs[0].coins[0].amount;
        const asset = "BNB";
        const message = msg.tx.memo || "";

        const result = await client.transfer(addressFrom, addressTo, amount, asset, message, null);

        const rawHex = result.serialize();
        const buffer = Buffer.from(rawHex, "hex");
        const txid = SHA256(buffer.toString()).toString().toUpperCase();

        const pub_key = result.signatures[0].pub_key.toString("hex");
        const signature = new Buffer(result.signatures[0].signature, "base64").toString("base64");

        return {
          account_number: result.account,
          chain_id: result.chain_id,
          data: null,
          memo: result.memo,
          msgs: result.msgs,
          signatures: {
            pub_key,
            signature,
          },
          txid,
          serialized: result.serialized,
        };
      });
    }
  };
}
