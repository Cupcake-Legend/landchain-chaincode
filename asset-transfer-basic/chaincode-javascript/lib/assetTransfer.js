/*
 * Copyright IBM Corp. All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict';

// Deterministic JSON.stringify()
const stringify = require('json-stringify-deterministic');
const sortKeysRecursive = require('sort-keys-recursive');
const { Contract } = require('fabric-contract-api');
const crypto = require('crypto');

const { KeyManagementServiceClient } = require('@google-cloud/kms');
const { exists } = require('fs');

class AssetTransfer extends Contract {

    async InitLedger(ctx) {
        const certificates = [
            {
                id: 'certificate_hash',
                editions:
                    [
                        {
                            id: 'certificate_edition_hash',
                            owners:
                                [
                                    {
                                        id: 'hash(kms_key_id)',
                                    }
                                ],
                            timestamp: 'now()',
                        }
                    ],
            }
        ];


        for (const certificate of certificates) {
            certificate.docType = 'certificate';
            await ctx.stub.putState(certificate.id, Buffer.from(stringify(sortKeysRecursive(certificate))));
        }
    }

    async verifySignature(signatureBase64, publicKeyPem, transactionData) {
        const signatureBuffer = Buffer.from(signatureBase64, 'base64');

        const verifier = crypto.createVerify('sha256');
        verifier.update(transactionData);
        verifier.end();

        const isValid = verifier.verify(publicKeyPem, signatureBuffer);
        return isValid;
    }

    async CreateAsset(ctx, certificateHash, certificateEditionHash, participantsJSON, transactionData) {
        const participants = JSON.parse(participantsJSON);

        participants.forEach(p => {
            if (p.public_key_pem) {
                p.public_key_pem = p.public_key_pem.replace(/\\n/g, '\n');
            }
        });

        const existsBytes = await ctx.stub.getState(certificateHash);
        const certificateExists = existsBytes && existsBytes.length > 0;

        const currentOwners = participants
            .filter(p => p.type === 'buyer' || p.type === 'owner')
            .map(p => p.kms_key_id)
            .sort();

        let certificates = [];
        if (certificateExists) {
            certificates = JSON.parse(existsBytes.toString());
            const latestEdition = certificates[0].editions[certificates[0].editions.length - 1];

            const latestOwners = latestEdition.owners.map(o => o.id).sort();
            const sellers = participants
                .filter(p => p.type === 'seller')
                .map(p => p.kms_key_id)
                .sort();

            if (JSON.stringify(latestOwners) !== JSON.stringify(sellers)) {
                throw new Error("Previous Owner Doesn't match");
            }
        }

        await Promise.all(participants.map(async (participant) => {
            if (!participant.public_key_pem) {
                throw new Error(`Missing public_key_pem for participant ${participant.kms_key_id || participant.id}`);
            }

            const verified = await this.verifySignature(
                participant.signature,
                participant.public_key_pem,
                transactionData
            );

            if (!verified) {
                throw new Error(`Signature verification failed for ${participant.kms_key_id || participant.id}`);
            }
        }));

        const txTimestamp = ctx.stub.getTxTimestamp();
        const timestamp = new Date(txTimestamp.seconds * 1000).toISOString();

        const newEdition = {
            id: certificateEditionHash,
            owners: currentOwners.map(id => ({ id })),
            timestamp: timestamp,
        };

        if (certificateExists) {
            certificates[0].editions.push(newEdition);
        } else {
            certificates.push({
                id: certificateHash,
                editions: [newEdition],
            });
        }

        await ctx.stub.putState(
            certificateHash,
            Buffer.from(JSON.stringify(certificates))
        );

        return JSON.stringify(certificates);
    }


    // ReadAsset returns the asset stored in the world state with given id.
    async ReadAsset(ctx, id) {
        const assetJSON = await ctx.stub.getState(id); // get the asset from chaincode state
        if (!assetJSON || assetJSON.length === 0) {
            throw new Error(`The asset ${id} does not exist`);
        }
        return assetJSON.toString();
    }

    // UpdateAsset updates an existing asset in the world state with provided parameters.
    async UpdateAsset(ctx, id, color, size, owner, appraisedValue) {
        const exists = await this.AssetExists(ctx, id);
        if (!exists) {
            throw new Error(`The asset ${id} does not exist`);
        }

        // overwriting original asset with new asset
        const updatedAsset = {
            ID: id,
            Color: color,
            Size: size,
            Owner: owner,
            AppraisedValue: appraisedValue,
        };
        // we insert data in alphabetic order using 'json-stringify-deterministic' and 'sort-keys-recursive'
        return ctx.stub.putState(id, Buffer.from(stringify(sortKeysRecursive(updatedAsset))));
    }

    // DeleteAsset deletes an given asset from the world state.
    async DeleteAsset(ctx, id) {
        const exists = await this.AssetExists(ctx, id);
        if (!exists) {
            throw new Error(`The asset ${id} does not exist`);
        }
        return ctx.stub.deleteState(id);
    }

    // AssetExists returns true when asset with given ID exists in world state.
    async AssetExists(ctx, id) {
        const assetJSON = await ctx.stub.getState(id);
        return assetJSON && assetJSON.length > 0;
    }

    // TransferAsset updates the owner field of asset with given id in the world state.
    async TransferAsset(ctx, id, newOwner) {
        const assetString = await this.ReadAsset(ctx, id);
        const asset = JSON.parse(assetString);
        const oldOwner = asset.Owner;
        asset.Owner = newOwner;
        // we insert data in alphabetic order using 'json-stringify-deterministic' and 'sort-keys-recursive'
        await ctx.stub.putState(id, Buffer.from(stringify(sortKeysRecursive(asset))));
        return oldOwner;
    }

    async GetAssetHistory(ctx, assetID) {
        console.info(`Getting history for asset: ${assetID}`);
        const iterator = await ctx.stub.getHistoryForKey(assetID);
        const allResults = [];

        while (true) {
            const res = await iterator.next();

            if (res.value && res.value.value.toString()) {
                const record = JSON.parse(res.value.value.toString('utf8'));
                allResults.push({
                    txId: res.value.txId,
                    timestamp: res.value.timestamp,
                    isDelete: res.value.is_delete,
                    record,
                });
            }

            if (res.done) {
                await iterator.close();
                break;
            }
        }

        return JSON.stringify(allResults);
    }


    // GetAllAssets returns all assets found in the world state.
    async GetAllAssets(ctx) {
        const allResults = [];
        // range query with empty string for startKey and endKey does an open-ended query of all assets in the chaincode namespace.
        const iterator = await ctx.stub.getStateByRange('', '');
        let result = await iterator.next();
        while (!result.done) {
            const strValue = Buffer.from(result.value.value.toString()).toString('utf8');
            let record;
            try {
                record = JSON.parse(strValue);
            } catch (err) {
                console.log(err);
                record = strValue;
            }
            allResults.push(record);
            result = await iterator.next();
        }
        return JSON.stringify(allResults);
    }


}

module.exports = AssetTransfer;
