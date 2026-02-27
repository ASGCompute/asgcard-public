import {
  getAccount,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction
} from "@solana/web3.js";
import { InsufficientBalanceError, PaymentError } from "../errors";
import type {
  WalletAdapter,
  X402Accept,
  X402Challenge,
  X402PaymentProof
} from "../types";

const isChallenge = (input: unknown): input is X402Challenge => {
  if (!input || typeof input !== "object") {
    return false;
  }

  const asRecord = input as Record<string, unknown>;
  return asRecord.x402Version === 1 && Array.isArray(asRecord.accepts);
};

export const parseChallenge = (input: unknown): X402Accept => {
  if (!isChallenge(input) || input.accepts.length === 0) {
    throw new PaymentError("Invalid x402 challenge payload");
  }

  return input.accepts[0];
};

export const checkBalance = async (params: {
  connection: Connection;
  owner: PublicKey;
  usdcMint: PublicKey;
  requiredAtomic: bigint;
}): Promise<void> => {
  const associatedAddress = await getAssociatedTokenAddress(
    params.usdcMint,
    params.owner,
    false
  );

  const account = await getAccount(params.connection, associatedAddress);

  if (account.amount < params.requiredAtomic) {
    throw new InsufficientBalanceError(
      params.requiredAtomic.toString(),
      account.amount.toString()
    );
  }
};

const buildTransferTransaction = async (params: {
  connection: Connection;
  usdcMint: PublicKey;
  fromOwner: PublicKey;
  toOwner: PublicKey;
  amountAtomic: bigint;
}): Promise<Transaction> => {
  const fromTokenAddress = await getAssociatedTokenAddress(
    params.usdcMint,
    params.fromOwner,
    false
  );
  const toTokenAddress = await getAssociatedTokenAddress(
    params.usdcMint,
    params.toOwner,
    false
  );

  const tx = new Transaction();

  try {
    await getAccount(params.connection, toTokenAddress);
  } catch {
    tx.add(
      createAssociatedTokenAccountInstruction(
        params.fromOwner,
        toTokenAddress,
        params.toOwner,
        params.usdcMint
      )
    );
  }

  tx.add(
    createTransferInstruction(
      fromTokenAddress,
      toTokenAddress,
      params.fromOwner,
      params.amountAtomic
    )
  );

  return tx;
};

export const executePayment = async (params: {
  connection: Connection;
  accept: X402Accept;
  keypair?: Keypair;
  walletAdapter?: WalletAdapter;
}): Promise<string> => {
  const mint = new PublicKey(params.accept.asset);
  const to = new PublicKey(params.accept.payTo);
  const required = BigInt(params.accept.maxAmountRequired);

  if (!params.keypair && !params.walletAdapter) {
    throw new PaymentError("No signing wallet configured");
  }

  if (params.keypair) {
    await checkBalance({
      connection: params.connection,
      owner: params.keypair.publicKey,
      usdcMint: mint,
      requiredAtomic: required
    });

    const tx = await buildTransferTransaction({
      connection: params.connection,
      usdcMint: mint,
      fromOwner: params.keypair.publicKey,
      toOwner: to,
      amountAtomic: required
    });

    try {
      return await sendAndConfirmTransaction(params.connection, tx, [params.keypair], {
        commitment: "confirmed"
      });
    } catch (error) {
      throw new PaymentError(
        error instanceof Error ? error.message : "Failed to execute payment"
      );
    }
  }

  const wallet = params.walletAdapter as WalletAdapter;
  await checkBalance({
    connection: params.connection,
    owner: wallet.publicKey,
    usdcMint: mint,
    requiredAtomic: required
  });

  const tx = await buildTransferTransaction({
    connection: params.connection,
    usdcMint: mint,
    fromOwner: wallet.publicKey,
    toOwner: to,
    amountAtomic: required
  });

  try {
    const { blockhash, lastValidBlockHeight } =
      await params.connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;

    const signed = await wallet.signTransaction(tx);
    const txHash = await params.connection.sendRawTransaction(signed.serialize());

    await params.connection.confirmTransaction(
      {
        signature: txHash,
        blockhash,
        lastValidBlockHeight
      },
      "confirmed"
    );

    return txHash;
  } catch (error) {
    throw new PaymentError(
      error instanceof Error ? error.message : "Failed to execute payment"
    );
  }
};

export const buildPaymentProof = (input: {
  network: string;
  from: string;
  to: string;
  value: string;
  txHash: string;
}): string => {
  const payload: X402PaymentProof = {
    scheme: "exact",
    network: input.network,
    payload: {
      authorization: {
        from: input.from,
        to: input.to,
        value: input.value
      },
      txHash: input.txHash
    }
  };

  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
};

export const handleX402Payment = async (params: {
  connection: Connection;
  challengePayload: unknown;
  keypair?: Keypair;
  walletAdapter?: WalletAdapter;
}): Promise<string> => {
  const accept = parseChallenge(params.challengePayload);
  const txHash = await executePayment({
    connection: params.connection,
    accept,
    keypair: params.keypair,
    walletAdapter: params.walletAdapter
  });

  const from = params.keypair
    ? params.keypair.publicKey.toBase58()
    : (params.walletAdapter as WalletAdapter).publicKey.toBase58();

  return buildPaymentProof({
    network: accept.network,
    from,
    to: accept.payTo,
    value: accept.maxAmountRequired,
    txHash
  });
};
