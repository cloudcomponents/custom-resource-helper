import axios from 'axios';
import type {
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceCreateEvent,
  CloudFormationCustomResourceUpdateEvent,
  CloudFormationCustomResourceDeleteEvent,
  CloudFormationCustomResourceHandler,
  Context
} from 'aws-lambda';

import {
  logFactory as defaultLogFactory,
  LogFactory,
  Logger
} from './log-factory';

export interface ResourceHandlerReturn {
  physicalResourceId: string;
  responseData?: Record<string, unknown>;
}

export interface OnCreateHandler {
  (
    event: CloudFormationCustomResourceCreateEvent,
    context: Context,
    logger: Logger
  ): Promise<ResourceHandlerReturn>;
}

export interface OnUpdateHandler {
  (
    event: CloudFormationCustomResourceUpdateEvent,
    context: Context,
    logger: Logger
  ): Promise<ResourceHandlerReturn>;
}

export interface OnDeleteHandler {
  (
    event: CloudFormationCustomResourceDeleteEvent,
    context: Context,
    logger: Logger
  ): Promise<void>;
}

export interface ResourceHandler {
  onCreate?: OnCreateHandler;
  onUpdate?: OnUpdateHandler;
  onDelete?: OnDeleteHandler;
}

export interface ResourceHandlerFactory {
  (logger?: Logger): ResourceHandler | Promise<ResourceHandler>;
}

export const customResourceHelper = (
  resourceHandlerFactory: ResourceHandlerFactory,
  logFactory?: LogFactory
): CloudFormationCustomResourceHandler => async (event: CloudFormationCustomResourceEvent, context: Context): Promise<void> => {
  // Initialise default logger
  let logger = defaultLogFactory(event);
  try {
    // Replace logger if a factory was given
    if (logFactory) {
      logger = logFactory(event, context);
    }
    const resourceHandler = await resourceHandlerFactory(logger);
    return await Promise.race([
      handleRessource(event, context, resourceHandler, logger),
      handleTimeout(context, logger)
    ]);
    // Catch any exceptions, log the stacktrace, send a failure back to
    // CloudFormation and then raise an exception
  } catch (error) {
    logger.error(error);
    const responseDetails: SendResponseDetails = {
      responseStatus: 'FAILED',
      reason: error.message || 'Internal Error'
    };
    return sendResponse(event, context, responseDetails, logger);
  }
};

interface SendResponseDetails {
  responseStatus: 'SUCCESS' | 'FAILED';
  responseData?: Record<string, unknown>;
  physicalResourceId?: string;
  reason?: string;
}

const sendResponse = async (
  event: CloudFormationCustomResourceEvent,
  context: Context,
  sendResponseDetails: SendResponseDetails,
  logger: Logger
): Promise<void> => {
  const {
    responseStatus,
    physicalResourceId,
    responseData,
    reason
  } = sendResponseDetails;

  const responseBody = JSON.stringify({
    Status: responseStatus,
    Reason:
      reason ||
      `See the details in CloudWatch Log Stream: ${context.logStreamName}`,
    PhysicalResourceId: physicalResourceId || 'None',
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: responseData || {}
  });

  logger.debug('Response body:');
  logger.debug(responseBody);

  const responseUrl = event.ResponseURL;
  logger.debug(`CFN response URL: ${responseUrl}`);

  try {
    const response = await axios.put(responseUrl, responseBody, {
      headers: { 'content-type': '', 'content-length': responseBody.length }
    });

    logger.info(`CloudFormation returned status code: ${response.status}`);
  } catch (error) {
    logger.error('sendResponse(...) failed executing axios.put:');
    logger.error(error);
    throw error;
  }
};

const handleRessource = async (
  event: CloudFormationCustomResourceEvent,
  context: Context,
  resourceHandler: ResourceHandler,
  logger: Logger
): Promise<void> => {
  logger.debug(event);

  // Define a physicalResourceId for the resource, if the event is an update and the
  // returned physicalResourceId changes, cloudformation will then issue a delete
  // against the old id
  let physicalResourceId = 'None';

  // Define an object to place any response information you would like to send
  // back to CloudFormation(these keys can then be used by Fn:: GetAttr)
  let responseData = {};

  // Execute custom resource handlers
  const { onCreate, onUpdate, onDelete } = resourceHandler;

  switch (event.RequestType) {
    case 'Create':
      if(onCreate) {
        ({ physicalResourceId, responseData = {} } = await onCreate(
          event,
          context,
          logger
        ));
      }
      break;
    case 'Update':
      if(onUpdate) {
        ({ physicalResourceId, responseData = {} } = await onUpdate(
          event,
          context,
          logger
        ));
      }
      break;
    case 'Delete':
      if(onDelete) {
        await onDelete(event, context, logger);
      }
      break;
    default:
      throw new Error('Invalid RequestType received');
  }

  // Send response back to CloudFormation
  const responseDetails: SendResponseDetails = {
    responseStatus: 'SUCCESS',
    reason: 'OK',
    responseData,
    physicalResourceId
  };
  return sendResponse(event, context, responseDetails, logger);
};

const handleTimeout = async (context: Context, logger: Logger): Promise<void> =>
  new Promise((_, reject) => {
    setTimeout(() => {
      logger.error('Execution is about to time out, sending failure message');
      reject(new Error('Execution timed out'));
    }, context.getRemainingTimeInMillis() - 3000);
  });
