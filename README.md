# LandChain: Decentralized Land Certificate Management

This repository contains the **Chaincode** (Smart Contracts) and **Express.js API Gateway** for a blockchain-based land certificate system. The project focuses on securing land records using document hashing and multi-party digital signature consensus.

## 🏗 System Architecture

The system operates through three primary layers:

1. **Chaincode (Hyperledger Fabric)**: Manages the immutable ledger and validates cryptographic signatures.
2. **Middleware (Express.js)**: Acts as the gRPC bridge, handling identity management and transaction routing.
3. **Client (Laravel)**: The user interface for uploading certificates and initiating verification (repository separate).

---

## 🛠 Features & Logic

### 1. Multi-Party Signature Consensus

Unlike standard automated consensus, this system requires the agreement of all parties involved in a transaction.

* Each participant signs the `transactionData` using their Google Cloud KMS-managed keys.
* The chaincode's `CreateAsset` function verifies every signature against the provided `public_key_pem` before committing the data.
* If a single signature is invalid or a previous owner's ID does not match, the transaction is rejected.

### 2. Document Hashing & Privacy

* Sensitive land certificate data is not stored on the blockchain. Instead, a **SHA-256 hash** of the document is stored.
* This ensures data privacy while allowing anyone with the original document to verify its authenticity by comparing hashes.

### 3. Scalable Performance

* The system is optimized for high-throughput peer environments.
* Empirical results show a **0.62s performance gain** when scaling from 2 to 6 peers, demonstrating the efficiency of the signature-based consensus model.

---

## 🚀 Getting Started

### Prerequisites

* Hyperledger Fabric (v2.x or later)
* Node.js (v18+)
* Docker & Docker Compose

### Installation

1. **Clone the repository**:
```bash
git clone https://github.com/Cupcake-Legend/landchain-chaincode.git
cd landchain-chaincode

```


2. **Install Dependencies**:
```bash
npm install

```



### Running the API Gateway

The Express.js server facilitates communication with the Fabric test-network. Ensure your network is running and the chaincode is deployed.

```bash
node server.js

```

The REST API will be available at `http://localhost:3000`.

---

## 📡 API Endpoints

| Method | Endpoint | Description |
| --- | --- | --- |
| **POST** | `/api/init` | Initializes the ledger with dummy data. |
| **GET** | `/api/certificates` | Retrieves all certificate records from the ledger. |
| **POST** | `/api/insert-certificate` | Validates signatures and records a new certificate edition. |
| **POST** | `/api/verify-certificate` | Checks if a specific hash exists and if it is the latest edition. |

### Sample Payload for `/api/insert-certificate`

```json
{
  "certificateHash": "hash_of_original_document",
  "certificateEditionHash": "hash_of_current_edition",
  "transactionData": "metadata_string",
  "participantKeys": "[{\"kms_key_id\": \"id1\", \"signature\": \"...\", \"public_key_pem\": \"...\", \"type\": \"buyer\"}]"
}

```

---

## 🛡 Security Logic (Chaincode Snippet)

The core security is handled by the `verifySignature` function using the `crypto` module:

```javascript
async verifySignature(signatureBase64, publicKeyPem, transactionData) {
    const signatureBuffer = Buffer.from(signatureBase64, 'base64');
    const verifier = crypto.createVerify('sha256');
    verifier.update(transactionData);
    verifier.end();
    return verifier.verify(publicKeyPem, signatureBuffer);
}

```

---
