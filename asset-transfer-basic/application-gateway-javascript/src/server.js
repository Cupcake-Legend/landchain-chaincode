process.on('unhandledRejection', (err) => console.error('Unhandled Rejection:', err));
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));

const express = require('express');
const cors = require('cors');
const { connect, signers } = require('@hyperledger/fabric-gateway');
const crypto = require('node:crypto');
const fs = require('fs/promises');
const path = require('path');
const { TextDecoder } = require('util');
// server.js
const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const utf8Decoder = new TextDecoder();

// Fabric config
const mspId = 'Org1MSP';
const channelName = 'mychannel';
const chaincodeName = 'basic';
const cryptoPath = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'test-network',
    'organizations',
    'peerOrganizations',
    'org1.example.com'
);
const keyPath = path.resolve(
    cryptoPath,
    'users',
    'User1@org1.example.com',
    'msp',
    'keystore'
);
const certPath = path.resolve(
    cryptoPath,
    'users',
    'User1@org1.example.com',
    'msp',
    'signcerts'
);
const tlsCertPath = path.resolve(
    cryptoPath,
    'peers',
    'peer0.org1.example.com',
    'tls',
    'ca.crt'
);
const peerEndpoint = 'localhost:7051';
const peerHostAlias = 'peer0.org1.example.com';


async function newGrpcConnection() {
    const grpc = require('@grpc/grpc-js');
    const tlsRootCert = await fs.readFile(tlsCertPath);
    const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
    return new grpc.Client(peerEndpoint, tlsCredentials, {
        'grpc.ssl_target_name_override': peerHostAlias,
    });
}

async function newIdentity() {
    const certFiles = await fs.readdir(certPath);
    const credentials = await fs.readFile(path.join(certPath, certFiles[0]));
    return { mspId, credentials };
}

async function newSigner() {
    const keyFiles = await fs.readdir(keyPath);
    const privateKeyPem = await fs.readFile(path.join(keyPath, keyFiles[0]));
    const privateKey = crypto.createPrivateKey(privateKeyPem);
    return signers.newPrivateKeySigner(privateKey);
}

async function getContract() {
    const client = await newGrpcConnection();
    const gateway = connect({
        client,
        identity: await newIdentity(),
        signer: await newSigner(),
        hash: require('@hyperledger/fabric-gateway').hash.sha256,
    });

    const network = gateway.getNetwork(channelName);
    const contract = network.getContract(chaincodeName);
    return { contract, gateway, client };
}

//Init ledger
app.post('/api/init', async (req, res) => {
    try {
        const { contract, gateway, client } = await getContract();
        await contract.submitTransaction('InitLedger');
        res.json({ message: 'Ledger initialized' });
        gateway.close();
        client.close();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


//Get all assets
app.get('/api/certificates', async (req, res) => {
    try {
        const { contract, gateway, client } = await getContract();
        const result = await contract.evaluateTransaction('GetAllAssets');
        res.json(JSON.parse(utf8Decoder.decode(result)));
        gateway.close();
        client.close();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


//insert and validation
app.post('/api/insert-certificate', async (req, res) => {
    const { certificateHash, transactionData, certificateEditionHash, participantKeys } = req.body;

    if (!certificateHash || !transactionData || !certificateEditionHash || !participantKeys) {
        return res.status(400).json({ success: false, error: 'Data incomplete!' });
    }

    try {
        const { contract, gateway, client } = await getContract();
        const result = await contract.submitTransaction(
            'CreateAsset',
            certificateHash,
            certificateEditionHash,
            participantKeys,
            transactionData,
        );

        console.log('Chaincode result:', result.toString());

        gateway.close();
        client.close();

        return res.status(200).json({
            success: true,
            message: `Certificate ${certificateEditionHash} successfully recorded.`,
            result: result.toString()
        });

    } catch (err) {
        console.error('Chaincode error:', err);
        return res.status(500).json({
            success: false,
            error: err.message || 'Blockchain transaction failed.'
        });
    }
});



// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`REST API listening on http://localhost:${PORT}`);
});