import { useState, useCallback, useEffect } from "react";
import { OpenAPIObject } from "openapi3-ts/oas31";
import { RedocStandalone } from "redoc";
import type RequestStore from "../lib/RequestStore";
import requestStore from "./helpers/request-store";
import { isValidRequest, parseJSON, safelyGetURLHost } from "../utils/helpers";
import { EndpointsByHost, Endpoint, JSONType, Status } from "../utils/types";
import Context from "./context";
import Control from "./Control";
import Start from "./Start";
import classes from "./main.module.css";
import endpointsToOAI31 from "../lib/endpoints-to-oai31";
import { sortEndpoints } from './helpers/endpoints-by-host';
import { isEmpty } from "lodash";

function Main() {
  const [spec, setSpec] = useState<OpenAPIObject | null>(null);
  const [endpoints, setEndpoints] = useState<Array<Endpoint>>([]);
  const [endpointsByHost, setEndpointsByHost] = useState<EndpointsByHost>([]);
  const [allHosts, setAllHosts] = useState<Set<string>>(new Set());
  const [disabledHosts, setDisabledHosts] = useState<Set<string>>(new Set());
  const initialStatus = isEmpty(requestStore.get())
    ? Status.INIT
    : Status.RECORDING;
  const [status, setStatus] = useState(initialStatus);

  const requestFinishedHandler = useCallback(
    (harRequest: chrome.devtools.network.Request) => {
      if (!isValidRequest(harRequest)) return;
      async function getCurrentTab() {
        try {
          harRequest.getContent((content) => {
            try {
              const responseBody: JSONType = parseJSON(content);
              requestStore.insert(harRequest, responseBody);
              setSpecEndpoints();
              const host = safelyGetURLHost(harRequest.request.url);
              if (host && !allHosts.has(host)) {
                setAllHosts((prev) => new Set(prev).add(host));
              }
            } catch {
              return;
            }
          });
        } catch {
          return;
        }
      }

      getCurrentTab();
    },
    []
  );

  useEffect(() => {
    return () => {
      chrome.devtools.network.onRequestFinished.removeListener(
        requestFinishedHandler
      );
    };
  }, []);

  const setSpecEndpoints = useCallback(async () => {
    const nextEndpoints = requestStore.endpoints();
    setSpec(endpointsToOAI31(nextEndpoints).getSpec());
    setEndpoints(sortEndpoints(nextEndpoints));
    // setEndpointsByHost(getEndpointsByHost(nextEndpoints));
  }, []);

  useEffect(() => {
    requestStore.setDisabledHosts(disabledHosts);
    setSpecEndpoints();
  }, [disabledHosts]);

  useEffect(() => {
    switch (status) {
      case Status.INIT:
        chrome.devtools.network.onRequestFinished.removeListener(
          requestFinishedHandler
        );
        requestStore.clear();
        setSpec(null);
        setAllHosts(new Set());
        setDisabledHosts(new Set());
        break;
      case Status.STOPPED:
        chrome.devtools.network.onRequestFinished.removeListener(
          requestFinishedHandler
        );
        break;
      case Status.RECORDING:
        chrome.devtools.network.onRequestFinished.addListener(
          requestFinishedHandler
        );
        break;
    }
  }, [status]);

  const parameterise = useCallback<typeof RequestStore.prototype.parameterise>(
    (index, path, host) => {
      requestStore.parameterise(index, path, host);
      setSpecEndpoints();
    },
    []
  );

  const start = useCallback(() => {
    setStatus(Status.RECORDING);
  }, []);

  const stop = useCallback(() => {
    setStatus(Status.STOPPED);
  }, []);

  const clear = useCallback(() => {
    setStatus(Status.INIT);
  }, []);

  if (status === Status.INIT || spec === null) {
    return <Start start={start} />;
  }

  return (
    <Context.Provider
      value={{
        allHosts,
        setAllHosts,
        endpointsByHost,
        setEndpointsByHost,
        disabledHosts,
        setDisabledHosts,
        parameterise,
        endpoints,
      }}
    >
      <div className={classes.wrapper}>
        <Control start={start} stop={stop} clear={clear} status={status} />
        <RedocStandalone
          spec={spec}
          options={{
            hideHostname: true,
            sortEnumValuesAlphabetically: true,
            sortOperationsAlphabetically: true,
            sortPropsAlphabetically: true,
            hideLoading: true,
            nativeScrollbars: true,
            downloadFileName: 'openapi-devtools-spec.json',
            expandDefaultServerVariables: false,
            expandSingleSchemaField: false,
            
          }}
        />
      </div>
    </Context.Provider>
  );
}

export default Main;
