import camelcase from 'lodash.camelcase';
import stringSimilarity from 'string-similarity';

export default {
  handleType(value) {
    let type = value;
    if (typeof value !== 'function') {
      type = value.constructor;
    }

    // Depending on the type of the default value,
    // select a default initializer function
    switch (type) {
      case String:
        return ['[value]'];
      case Array:
        return ['<list>'];
      case Number:
      case parseInt:
        return ['<n>', parseInt];
      default:
        return [''];
    }
  },

  readOption(option) {
    let value = option.defaultValue;
    const contents = {};

    // If option has been used, get its value
    for (const name of option.usage) {
      const fromArgs = this.raw[name];
      if (typeof fromArgs !== 'undefined') {
        value = fromArgs;
      }
    }

    let count = -1;
    // Process the option's value
    for (let name of option.usage) {
      count += 1;
      let propVal = value;

      // Convert the value to an array when the option is called just once
      if (
        Array.isArray(option.defaultValue) &&
        typeof propVal !== typeof option.defaultValue
      ) {
        if (count === 0) {
          this.raw._.push(propVal);
        }
        propVal = [propVal];
      }

      if (
        typeof option.defaultValue !== 'undefined' &&
        typeof propVal !== typeof option.defaultValue
      ) {
        if (count === 0) {
          this.raw._.push(propVal);
        }
        propVal = option.defaultValue;
      }

      let condition = true;

      if (option.init) {
        // Only use the toString initializer if value is a number
        if (option.init === toString) {
          condition = propVal.constructor === Number;
        }

        if (condition) {
          // Pass it through the initializer
          propVal = option.init(propVal);
        }
      }

      // Camelcase option name (skip short flag)
      if (name.length > 1) {
        name = camelcase(name);
      }

      // Add option to list
      contents[name] = propVal;
    }

    return contents;
  },

  getOptions(definedSubcommand) {
    const options = {};
    const args = {};
    let optsMsg = ''

    // Set option defaults
    for (const option of this.details.options) {
      if (typeof option.defaultValue === 'undefined') {
        continue; // eslint-disable-line
      }

      Object.assign(options, this.readOption(option));
    }

    // Copy over the arguments
    Object.assign(args, this.raw);
    const _ = [...args._];
    delete args._;

    // Override defaults if used in command line
    for (const option in args) {
      if (!{}.hasOwnProperty.call(args, option)) {
        continue; // eslint-disable-line
      }
      const related = this.isDefined(option, 'options');

      if (related) {
        const details = this.readOption(related);
        Object.assign(options, details);
      }

      if (!related && !definedSubcommand) {
        // Unknown Option
        const availableOptions = [];
        this.details.options.forEach((opt) => {
          availableOptions.push(...opt.usage);
        });

        const suggestOption = stringSimilarity.findBestMatch(
          option,
          availableOptions,
        );
        
        optsMsg += ` The option "${option}" is unknown.\n`

        if (suggestOption.bestMatch.rating >= 0.5) {
          optsMsg += ' Did you mean the following one?\n';

          const suggestion = this.details.options.filter((item) => {
            for (const flag of item.usage) {
              if (flag === suggestOption.bestMatch.target) {
                return true;
              }
            }

            return false;
          });

          optsMsg += `${this.generateDetails(suggestion)[0].trim()}\n`;
        } else {
          optsMsg += ' Here\'s a list of all available options: \n';
          optsMsg += this.showHelp();
        }
        break
      }
    }

    options._ = _;
    if (optsMsg) options.unknownOptionMessage = optsMsg;
    return options;
  },

  generateExamples() {
    const { examples } = this.details;
    const parts = [];

    for (const item in examples) {
      if (!{}.hasOwnProperty.call(examples, item)) {
        continue; // eslint-disable-line
      }
      const usage = this.printSubColor(`$ ${examples[item].usage}`);
      const description = this.printMainColor(`- ${examples[item].description}`);
      parts.push(`  ${description}\n\n    ${usage}\n\n`);
    }

    return parts;
  },

  generateDetails(kind) {
    // Get all properties of kind from global scope
    const items = typeof kind === 'string' ? [...this.details[kind]] : [...kind];
    const parts = [];
    const isCmd = kind === 'commands';

    // Sort items alphabetically
    items.sort((a, b) => {
      const first = isCmd ? a.usage : a.usage[1];
      const second = isCmd ? b.usage : b.usage[1];

      switch (true) {
        case first < second:
          return -1;
        case first > second:
          return 1;
        default:
          return 0;
      }
    });

    for (const item in items) {
      if (!{}.hasOwnProperty.call(items, item)) {
        continue; // eslint-disable-line
      }

      let { usage } = items[item];
      let initial = items[item].defaultValue;

      // If usage is an array, show its contents
      let usageString
      if (usage.constructor === Array) {
        if (isCmd) {
          usageString = usage.join(', ');
        } else {
          const isVersion = usage.indexOf('v');
          usageString = `-${usage[0]}`;
          if (usage.length > 1 && usage[1].length > 1) usageString += `, --${usage[1]}`;

          if (!initial) {
            initial = items[item].init;
          }

          usageString += initial && isVersion === -1
            ? ` ${this.handleType(initial)[0]}`
            : '';
        }
      } else {
        usageString = usage
      }

      // Overwrite usage with readable syntax
      items[item].usage = usageString;
    }

    // Find length of longest option or command
    // Before doing that, make a copy of the original array
    const longest = items.slice().sort((a, b) => b.usage.length - a.usage.length)[0].usage.length;

    for (const item of items) {
      let { usage, description } = item;
      const { defaultValue } = item;
      const difference = longest - usage.length;

      // Compensate the difference to longest property with spaces
      usage += ' '.repeat(difference);
      parts.push(`  ${this.printMainColor(usage)}  ${this.printSubColor(description)}`);
    }

    return parts;
  },

  runCommand(details, options) {
    // If help is disabled, remove initializer
    if (details.usage === 'help' && !this.config.help) {
      details.init = false; // eslint-disable-line
    }

    // If command has initializer, call it
    if (details.init) {
      const sub = [].concat(this.sub);
      sub.shift();

      return details.init.bind(this)(details.usage, sub, options);
    }

    return '';
  },

  isDefined(name, list) {
    // Get all items of kind
    const children = this.details[list];

    // Check if a child matches the requested name
    for (const child of children) {
      let { usage } = child;
      let type = usage.constructor;

      if (type === String) {
        usage = this.usageStringToArrayForm(usage)
        type = Array
      }

      if (type === Array && usage.indexOf(name) > -1) {
        return child;
      }
    }

    // If nothing matches, item is not defined
    return false;
  },

  // a usage string is in the form "-a" or "-f, --file"
  // name is in the form, "a" or "file".
  usageStringToArrayForm(usageString) {
    return usageString.split(", ").map(str => str.replace(/-/g, ''))
  }
};
