import { Red, NodeProperties, Node as NRNode } from 'node-red';
import { Node } from 'node-red-contrib-typescript-node';
import { API, APIObject, PlatformLoginHandler, CozytouchLoginHandler, DefaultLoginHandler } from 'overkiz-api';
import { Application } from 'express';
import { CookieJar } from 'request';

export interface IOverkizGateway extends NRNode {
  getObjects(): Promise<APIObject[] | null>;
  getObjectByUrl(url: string): Promise<APIObject | null>;
};

interface IGatewayNodeProperties extends NodeProperties {
  host: string;
  loginHandler: string;
};

interface ICredentials {
  username: string;
  password: string;
};

interface IDeviceState {
  name: string;
}

interface IDeviceCommand {
  name: string;
  nbParams: number;
}

interface IDeviceInfo {
  URL: string;
  name: string;
  uiClass: string;
  states: IDeviceState[];
  commands: IDeviceCommand[];
}

module.exports = function (RED: Red) {
  class OverkizGateway extends Node implements IOverkizGateway {

    private host: string;
    private credentials: ICredentials;
    private overkizApi: API;
    private loginHandler: PlatformLoginHandler;

    constructor(config: IGatewayNodeProperties) {
      super(RED);

      this.createNode(config);
      this.host = config.host;

      switch (config.loginHandler?.toLowerCase()) {
        case 'cozytouch':
          this.loginHandler = new CozytouchLoginHandler(this.credentials.username, this.credentials.password);
          break;

        default:
          this.loginHandler = new DefaultLoginHandler(this.credentials.username, this.credentials.password);
          break;
      }

      this.overkizApi = new API({
        host: this.host,
        platformLoginHandler: this.loginHandler,
        polling: {
          always: false,
          interval: 1000
        }
      });

      const cookies = this.context().global.get('overkizGatewayCookies') as Map<string, CookieJar> || new Map<string, CookieJar>();
      if (cookies.has(this.id)) {
        (this.overkizApi as any).cookies = cookies.get(this.id);
      }

      this.on('close', function (removed, done) {
        const cookies = this.context().global.get('overkizGatewayCookies') as Map<string, CookieJar> || new Map<string, CookieJar>();

        if (removed) {
          if (cookies.delete(this.id)) {
            this.context().global.set('overkizGatewayCookies', cookies);
          }
        } else {
          const anyApi = this.overkizApi as any;
          if (anyApi.cookies as CookieJar) {
            cookies.set(this.id, anyApi.cookies);
            this.context().global.set('overkizGatewayCookies', cookies);
          }
        }
        done();
      });
    }

    public async getObjects(): Promise<APIObject[] | null> {
      try {
        return await this.overkizApi.getObjects();
      }
      catch
      {
        return null;
      }
    }

    public async getObjectByUrl(url: string): Promise<APIObject | null> {
      const objects = await this.getObjects();
      if (!objects) {
        return null;
      }

      return objects.find(obj => obj.URL === url) || null;
    }
  }

  OverkizGateway.registerType(RED, "overkiz-gateway", {
    credentials: {
      username: { type: "text" },
      password: { type: "password" }
    }
  });

  (RED.httpAdmin as Application).get('/overkiz-gateway/:gatewayId/getDevices', async (req, res) => {
    const node = RED.nodes.getNode(req.params.gatewayId);
    if (node instanceof OverkizGateway) {
      const objects = await node.getObjects();
      if (objects) {
        const devInfos: IDeviceInfo[] = [];

        objects.forEach(device => {
          const devInfo: IDeviceInfo =
          {
            URL: device.URL,
            name: device.name,
            uiClass: device.uiClass,
            states: [],
            commands: []
          };

          device.definition.states.forEach(devState => {
            const state: IDeviceState =
            {
              name: devState.name
            };
            devInfo.states.push(state);
          });

          device.definition.commands.forEach(devCmd => {
            const cmd: IDeviceCommand =
            {
              name: devCmd.name,
              nbParams: devCmd.nbParams
            };
            devInfo.commands.push(cmd);
          });

          devInfos.push(devInfo);
        });
        res.json(devInfos);
      }
      else {
        res.sendStatus(500);
      }
    }
    else {
      res.sendStatus(404);
    }
  });
};