import {checkFileExistsWithReason} from '@libs/fileDownload/checkFileExists';
import {readFileAsync} from '@libs/fileDownload/FileUtils';
import Log from '@libs/Log';
import ReceiptStorage from '@libs/ReceiptStorage';
import {logReceiptDropped} from '@libs/telemetry/ReceiptObservability';
import validateFormDataParameter from '@libs/validateFormDataParameter';

import type {Receipt} from '@src/types/onyx/Transaction';

import type PrepareRequestPayload from './types';

const prepareRequestPayload: PrepareRequestPayload = (command, data, initiatedOffline) => {
    const formData = new FormData();
    let promiseChain = Promise.resolve();

    for (const key of Object.keys(data)) {
        promiseChain = promiseChain.then(() => {
            const value = data[key];

            if (value === undefined || value === null) {
                return Promise.resolve();
            }

            if (key === 'receipt') {
                const {source, name, type, receiptTraceId} = value as Omit<File, 'source'> & Pick<Receipt, 'receiptTraceId' | 'source'>;

                if (source) {
                    if (typeof source === 'number') {
                        return Promise.resolve();
                    }

                    const localUri = ReceiptStorage.resolve(source) ?? source;

                    return checkFileExistsWithReason(localUri).then(({exists, error}) => {
                        if (!exists) {
                            const transactionID = typeof data.transactionID === 'string' ? data.transactionID : undefined;
                            logReceiptDropped({receiptTraceId, transactionID, command, source, fileName: name, statError: error});
                            return;
                        }
                        const receiptFormData = {
                            uri: localUri,
                            name,
                            type,
                        };
                        validateFormDataParameter(command, key, receiptFormData);
                        formData.append(key, receiptFormData as File);
                    });
                }
            }

            if (key === 'file' && initiatedOffline) {
                const {uri: path = '', source, name, type} = value as File;
                if (!source) {
                    validateFormDataParameter(command, key, value);
                    formData.append(key, value as string | Blob);

                    return Promise.resolve();
                }
                const fileName = name || (path ? (path.split('/').pop() ?? '') : '') || '';
                const localUri = ReceiptStorage.resolve(source) ?? source;
                return readFileAsync(
                    localUri,
                    fileName,
                    () => {
                        Log.alert('[Attachment] dropped', {event: 'dropped', command, source, fileName});
                    },
                    undefined,
                    type,
                ).then((file) => {
                    if (!file) {
                        Log.alert('[Attachment] dropped', {event: 'dropped', command, source, fileName});
                        return;
                    }

                    validateFormDataParameter(command, key, file);
                    formData.append(key, file);
                });
            }

            validateFormDataParameter(command, key, value);
            formData.append(key, value as string | Blob);

            return Promise.resolve();
        });
    }

    return promiseChain.then(() => formData);
};

export default prepareRequestPayload;
